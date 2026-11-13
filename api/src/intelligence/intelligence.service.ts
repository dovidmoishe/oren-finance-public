import { Injectable, Logger } from '@nestjs/common';
import type { StockAnalysis, StockOpportunity } from '../../types/analysis';
import type { Equity } from '../../types/equity';
import type { MarketCandle } from '../../types/market';
import type { ScoreDimensions, StockSignals } from '../../types/signals';
import {
  DEFAULT_MIN_OPPORTUNITY_SCORE,
  DEFAULT_OPPORTUNITIES_LIMIT,
  SIGNAL_DAILY_LOOKBACK_DAYS,
  SIGNAL_TTL_MS,
  TA_DAILY_LOOKBACK_DAYS,
  TA_HOURLY_LOOKBACK_DAYS,
} from '../config/constants';
import type { ChartWindow } from '../tokens/chart-range.util';
import { NewsService } from '../news/news.service';
import { StockCatalogRepository } from '../tokens/stock-catalog.repository';
import { TokensService } from '../tokens/tokens.service';
import { buildHighlights, riskLabelFromVolatility } from './highlights';
import { momentum } from './indicators/momentum';
import { rsi } from './indicators/rsi';
import { sma } from './indicators/sma';
import { volatility } from './indicators/volatility';
import { volumeTrend } from './indicators/volume-trend';
import { computeOpportunityScore } from './scoring/opportunity-score';
import { SignalsRepository } from './signals.repository';
import { buildTechnicalSummary } from './ta/summary';
import { buildTechnicalBrief } from './ta/technical-brief';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(
    private readonly tokens: TokensService,
    private readonly repository: SignalsRepository,
    private readonly catalog: StockCatalogRepository,
    private readonly news: NewsService,
  ) {}

  async getSignals(
    assetId: string,
    options?: { force?: boolean },
  ): Promise<StockSignals> {
    if (!options?.force) {
      const cached = await this.repository.getByAssetId(assetId);
      if (
        cached &&
        Date.now() - cached.calculatedAt.getTime() < SIGNAL_TTL_MS
      ) {
        return cached;
      }
    }
    return this.computeAndPersist(assetId);
  }

  async getAnalysis(assetId: string): Promise<StockAnalysis> {
    const equity = await this.tokens.getStock(assetId);
    const { signals, dimensions, limitedHistory } =
      await this.computeSignalsDetailed(equity);

    await this.repository.upsert(signals);

    const price = equity.price ?? signals.sma20;
    const highlights = buildHighlights(signals, dimensions, {
      limitedHistory,
      price,
    });

    let tokensRisk: string | undefined;
    try {
      const risk = await this.tokens.getRisk(assetId);
      tokensRisk = risk.label ?? undefined;
    } catch {
      // risk optional
    }

    const riskLabel = riskLabelFromVolatility(signals.volatility30d, tokensRisk);
    const [dailyBars, hourlyBars, newsFeed] = await Promise.all([
      this.fetchTaBars(equity.id, TA_DAILY_LOOKBACK_DAYS, '1D'),
      this.fetchTaBars(equity.id, TA_HOURLY_LOOKBACK_DAYS, '1H'),
      this.news.getEquityNews(equity.id, { limit: 3 }).catch(() => ({
        assetId: equity.id,
        items: [],
      })),
    ]);

    const technicalBrief = buildTechnicalBrief({
      price,
      dailyBars,
      hourlyBars,
      newsItems: newsFeed.items,
    });
    const summary = buildTechnicalSummary({
      ticker: equity.ticker,
      opportunityScore: signals.opportunityScore,
      riskLabel,
      technicalBrief,
    });

    return {
      assetId: equity.id,
      ticker: equity.ticker,
      name: equity.name,
      opportunityScore: signals.opportunityScore,
      signals,
      highlights,
      summary,
      technicalBrief,
      riskLabel,
      analyzedAt: new Date(),
    };
  }

  async getOpportunities(options?: {
    limit?: number;
    minScore?: number;
  }): Promise<StockOpportunity[]> {
    const limit = clampInt(
      options?.limit ?? DEFAULT_OPPORTUNITIES_LIMIT,
      1,
      50,
    );
    const minScore = options?.minScore ?? DEFAULT_MIN_OPPORTUNITY_SCORE;

    const ranked = await this.repository.listByMinScore(minScore, limit);
    const stocks = await this.catalog.findByAssetIds(
      ranked.map((signals) => signals.assetId),
    );
    const byId = new Map(stocks.map((s) => [s.id, s]));

    return ranked.map((signals) => {
      const equity = byId.get(signals.assetId);
      const scored = computeOpportunityScore({
        momentum7d: signals.momentum7d,
        momentum30d: signals.momentum30d,
        price: equity?.price ?? signals.sma20,
        sma20: signals.sma20,
        sma50: signals.sma50,
        volumeTrend: signals.volumeTrend,
        volatility30d: signals.volatility30d,
        liquidityScore: signals.liquidityScore,
        activityScore: signals.activityScore,
      });

      return {
        assetId: signals.assetId,
        ticker: signals.ticker,
        name: equity?.name ?? signals.ticker,
        logo: equity?.logo,
        opportunityScore: signals.opportunityScore,
        price: equity?.price ?? signals.sma20,
        priceChange24h: equity?.priceChange24h ?? 0,
        highlights: buildHighlights(signals, scored.dimensions, {
          price: equity?.price ?? signals.sma20,
        }),
        signals: {
          momentum7d: signals.momentum7d,
          momentum30d: signals.momentum30d,
          volatility30d: signals.volatility30d,
          rsi14: signals.rsi14,
          volumeTrend: signals.volumeTrend,
          liquidityScore: signals.liquidityScore,
          activityScore: signals.activityScore,
        },
      } satisfies StockOpportunity;
    });
  }

  private async computeAndPersist(assetId: string): Promise<StockSignals> {
    const equity = await this.tokens.getStock(assetId);
    const { signals } = await this.computeSignalsDetailed(equity);
    return this.repository.upsert(signals);
  }

  private async computeSignalsDetailed(equity: Equity): Promise<{
    signals: StockSignals;
    dimensions: ScoreDimensions;
    limitedHistory: boolean;
  }> {
    let bars: MarketCandle[] = [];
    try {
      bars = await this.tokens.getCandlesForWindow(
        equity.id,
        this.buildCandleWindow(SIGNAL_DAILY_LOOKBACK_DAYS, '1D'),
      );
    } catch (err) {
      this.logger.warn(
        `Signal candles failed for ${equity.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    bars = [...bars].sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );

    const closes = bars.map((b) => b.close).filter((c) => Number.isFinite(c));
    const volumes = bars
      .map((b) => b.volume ?? 0)
      .filter((v) => Number.isFinite(v));

    const limitedHistory = closes.length < 30;
    const price = equity.price ?? closes[closes.length - 1] ?? 0;

    const momentum7d = momentum(closes, 7);
    const momentum30d = momentum(closes, 30);
    const rsi14 = rsi(closes, 14);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const volatility30d = volatility(closes, 30);
    const volTrend = volumeTrend(volumes, 7);

    const liquidityScore = normalizeLiquidity(equity);
    const activityScore = normalizeActivity(equity, price);

    const { score, dimensions } = computeOpportunityScore({
      momentum7d,
      momentum30d,
      price,
      sma20,
      sma50,
      volumeTrend: volTrend,
      volatility30d,
      liquidityScore,
      activityScore,
      limitedHistory,
    });

    const signals: StockSignals = {
      assetId: equity.id,
      ticker: equity.ticker,
      momentum7d: round(momentum7d),
      momentum30d: round(momentum30d),
      volatility30d: round(volatility30d),
      volumeTrend: round(volTrend),
      rsi14: round(rsi14),
      sma20: round(sma20),
      sma50: round(sma50),
      liquidityScore: round(liquidityScore),
      activityScore: round(activityScore),
      opportunityScore: score,
      calculatedAt: new Date(),
    };

    return { signals, dimensions, limitedHistory };
  }

  private buildCandleWindow(
    lookbackDays: number,
    interval: ChartWindow['interval'],
  ): ChartWindow {
    const to = Math.floor(Date.now() / 1000);
    return {
      interval,
      to,
      from: to - lookbackDays * 24 * 60 * 60,
    };
  }

  private async fetchTaBars(
    assetId: string,
    lookbackDays: number,
    interval: ChartWindow['interval'],
  ): Promise<MarketCandle[]> {
    try {
      const bars = await this.tokens.getCandlesForWindow(
        assetId,
        this.buildCandleWindow(lookbackDays, interval),
      );
      return [...bars].sort(
        (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
      );
    } catch (err) {
      this.logger.warn(
        `TA candles failed for ${assetId} (${interval}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}

function normalizeLiquidity(equity: Equity): number {
  const fromEquity = equity.liquidity;
  if (typeof fromEquity === 'number' && fromEquity > 0) {
    // Assume raw USD liquidity — log scale into 0–100
    return clamp(Math.log10(fromEquity + 1) * 15, 0, 100);
  }
  const variantLiq = equity.variants
    .map((v) => v.liquidity ?? 0)
    .filter((n) => n > 0);
  if (variantLiq.length > 0) {
    const max = Math.max(...variantLiq);
    return clamp(Math.log10(max + 1) * 15, 0, 100);
  }
  return 50;
}

function normalizeActivity(equity: Equity, price: number): number {
  const vol = equity.volume24h;
  if (typeof vol === 'number' && vol > 0) {
    return clamp(Math.log10(vol + 1) * 12, 0, 100);
  }
  if (typeof equity.priceChange24h === 'number') {
    return clamp(50 + Math.abs(equity.priceChange24h) * 2, 0, 100);
  }
  void price;
  return 50;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}
