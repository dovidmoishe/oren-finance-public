import { BadRequestException, Injectable } from '@nestjs/common';
import type { ResearchSource, StockResearch } from '../../types/research';
import { DripService } from '../drip/drip.service';
import { DRIP_OPINION_RESEARCH_LIMIT } from '../drip/drip.types';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { MarketService } from '../market/market.service';
import { NewsService } from '../news/news.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { CompanyResearchService } from './company/company-research.service';
import { opinionOverlay } from './opinion-overlay';
import { changesSince, snapshotOf } from './research-changes';
import { ResearchRepository } from './research.repository';
import type { SavedThesis } from '../../types/research';

@Injectable()
export class ResearchService {
  constructor(
    private readonly market: MarketService,
    private readonly intelligence: IntelligenceService,
    private readonly news: NewsService,
    private readonly portfolio: PortfolioService,
    private readonly drip: DripService,
    private readonly repository: ResearchRepository,
    private readonly company: CompanyResearchService,
  ) {}

  async getStock(
    assetId: string,
    caller: { userId: string; walletAddress: string; email?: string },
    options?: { audience?: 'app' | 'mcp' },
  ): Promise<StockResearch> {
    const stock = await this.resolveEquity(assetId);
    const id = stock.id;
    const [analysis, news, portfolio, opinions, company] = await Promise.all([
      settle(
        () => this.intelligence.getAnalysis(id),
        (value) => value.analyzedAt.toISOString(),
      ),
      settle(
        () =>
          this.news.getEquityNews(id, { limit: 5 }).then((feed) => feed.items),
        (items) => items[0]?.publishedAt?.toISOString(),
      ),
      settle(() =>
        this.portfolio.getPortfolio(caller.walletAddress).then((value) => {
          const position = value.positions.find((item) => item.assetId === id);
          return position
            ? {
                quantity: position.quantity,
                valueUsd: position.valueUsd,
                allocationPercent: position.allocationPercent,
                availableAmount: position.availableAmount,
                lockedAmount: position.lockedAmount,
              }
            : null;
        }),
      ),
      options?.audience === 'mcp'
        ? Promise.resolve({ available: false, reason: 'not_licensed' })
        : this.drip.enabledFor(caller)
          ? settle(
              async () => {
                const result = await this.drip.getOpinions(
                  stock.ticker,
                  DRIP_OPINION_RESEARCH_LIMIT,
                  caller,
                );
                if (!result.available) throw new Error(result.reason);
                return opinionOverlay(result)!;
              },
              (value) => value.asOf,
            )
          : Promise.resolve({ available: false, reason: 'not_enabled' }),
      this.company.load(stock).catch(() => ({
        available: false,
        reason: 'unavailable',
      })),
    ]);
    const report: StockResearch = {
      assetId: id,
      ticker: stock.ticker,
      name: stock.name,
      generatedAt: new Date().toISOString(),
      analysis,
      news,
      portfolio,
      opinions,
      company,
    };
    const saved = await this.repository.get(caller.userId, id);
    if (saved) {
      report.saved = saved;
      report.changes = changesSince(saved.snapshot, report);
    }
    await this.repository
      .recordEvent(caller.userId, id, saved ? 'revisit' : 'open')
      .catch(() => undefined);
    return report;
  }

  listSaved(userId: string): Promise<SavedThesis[]> {
    return this.repository.list(userId);
  }

  async save(
    report: StockResearch,
    userId: string,
    note: string,
  ): Promise<SavedThesis> {
    const saved = await this.repository.save(
      userId,
      report.assetId,
      note,
      snapshotOf(report),
    );
    await this.repository
      .recordEvent(userId, report.assetId, 'save')
      .catch(() => undefined);
    return saved;
  }

  async updateNote(
    userId: string,
    assetId: string,
    note: string,
  ): Promise<SavedThesis | undefined> {
    return this.repository.updateNote(userId, assetId, note);
  }

  remove(userId: string, assetId: string): Promise<void> {
    return this.repository.remove(userId, assetId);
  }

  recordSourceOpen(userId: string, assetId: string): Promise<void> {
    return this.repository.recordEvent(userId, assetId, 'source_open');
  }

  private async resolveEquity(assetId: string) {
    const direct = await this.market.getStock(assetId).catch(() => null);
    if (direct) return direct;
    const query = assetId.trim();
    const matches = (await this.market.searchStocks(query)).filter(
      (item) => item.ticker.toUpperCase() === query.toUpperCase(),
    );
    if (matches.length > 1) throw new BadRequestException('Ambiguous stock');
    if (matches.length !== 1)
      throw new BadRequestException('Unsupported stock');
    return this.market.getStock(matches[0].id);
  }
}

async function settle<T>(
  load: () => Promise<T>,
  observedAt?: (data: T) => string | undefined,
): Promise<ResearchSource<T>> {
  try {
    const data = await load();
    return {
      available: true,
      data,
      observedAt: observedAt?.(data) ?? new Date().toISOString(),
    };
  } catch (error) {
    return { available: false, reason: sourceReason(error) };
  }
}

function sourceReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'DRIP_TIMEOUT') return 'timeout';
  if (message === 'DRIP_RATE_LIMITED') return 'rate_limited';
  if (message === 'DRIP_UNAVAILABLE' || message === 'DRIP_FORBIDDEN') {
    return 'provider_unavailable';
  }
  if (message === 'DRIP_UNSET') return 'not_enabled';
  if (message === 'DRIP_BAD_TICKER') return 'not_mapped';
  if (
    [
      'unavailable',
      'not_enabled',
      'not_licensed',
      'not_mapped',
      'ambiguous_identity',
      'mint_mismatch',
      'identity_mismatch',
      'fund_no_statements',
      'no_coverage',
      'stale',
      'rate_limited',
      'provider_unavailable',
      'timeout',
      'sec_not_configured',
      'sec_preview_disabled',
      'sec_worker_unavailable',
    ].includes(message)
  ) {
    return message;
  }
  return 'unavailable';
}
