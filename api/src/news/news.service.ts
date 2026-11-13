import { BadRequestException, Injectable } from '@nestjs/common';
import type { Equity } from '../../types/equity';
import type { MarketNewsItem, NewsContext, NewsFeed } from '../../types/news';
import { NEWS_TTL_MS } from '../config/constants';
import { PortfolioService } from '../portfolio/portfolio.service';
import { TokensService } from '../tokens/tokens.service';
import { NewsRepository } from './news.repository';

const DEFAULT_NEWS_LIMIT = 10;
const MAX_NEWS_LIMIT = 25;
const DEFAULT_LIMIT_PER_ASSET = 3;

@Injectable()
export class NewsService {
  constructor(
    private readonly tokens: TokensService,
    private readonly portfolio: PortfolioService,
    private readonly repository: NewsRepository,
  ) {}

  async getEquityNews(
    assetId: string,
    options?: { limit?: number },
  ): Promise<NewsFeed> {
    const normalizedAssetId = assetId.trim();
    if (!normalizedAssetId) {
      throw new BadRequestException('assetId is required');
    }

    const equity = await this.tokens.getStock(normalizedAssetId);
    const items = await this.getCachedOrFetch(
      normalizedAssetId,
      clampLimit(options?.limit),
      equity,
    );

    return { assetId: normalizedAssetId, items };
  }

  async getMarketNews(options?: { limit?: number }): Promise<NewsFeed> {
    const items = await this.getCachedOrFetch(
      undefined,
      clampLimit(options?.limit),
    );
    return { items };
  }

  async getRecentNews(
    assetIds: string[],
    options?: { limitPerAsset?: number },
  ): Promise<MarketNewsItem[]> {
    const limitPerAsset = clampLimit(
      options?.limitPerAsset ?? DEFAULT_LIMIT_PER_ASSET,
    );
    const uniqueAssetIds = unique(assetIds.map((assetId) => assetId.trim()));
    const feeds = await Promise.all(
      uniqueAssetIds.map((assetId) =>
        this.getEquityNews(assetId, { limit: limitPerAsset }),
      ),
    );

    return sortNewestFirst(feeds.flatMap((feed) => feed.items));
  }

  async getNewsContextForAgent(input: {
    walletAddress?: string;
    assetIds?: string[];
    limitPerAsset?: number;
    maxItems?: number;
  }): Promise<NewsContext> {
    let assetIds = unique(
      (input.assetIds ?? []).map((assetId) => assetId.trim()).filter(Boolean),
    );

    if (assetIds.length === 0 && input.walletAddress) {
      const portfolio = await this.portfolio.getPortfolio(input.walletAddress);
      assetIds = unique(
        portfolio.positions.map((position) => position.assetId),
      );
    }

    const items = await this.getRecentNews(assetIds, {
      limitPerAsset: input.limitPerAsset,
    });
    const maxItems = clampLimit(input.maxItems);

    return {
      assetIds,
      items: items.slice(0, maxItems),
      generatedAt: new Date(),
    };
  }

  private async getCachedOrFetch(
    assetId: string | undefined,
    limit: number,
    equity?: Equity,
  ): Promise<MarketNewsItem[]> {
    const now = new Date();
    const cached = await this.repository.listFresh(assetId, now, limit);
    const cachedItems = filterNewsForEquity(cached, equity);
    if (cachedItems.length > 0) return cachedItems;

    const fetched = filterNewsForEquity(
      sortNewestFirst(await this.tokens.getNews(assetId)),
      equity,
    );
    await this.repository.replaceScope(
      assetId,
      fetched,
      new Date(now.getTime() + NEWS_TTL_MS),
    );

    return fetched.slice(0, limit);
  }
}

export function clampLimit(limit: unknown): number {
  const value =
    typeof limit === 'number'
      ? limit
      : typeof limit === 'string'
        ? Number(limit)
        : DEFAULT_NEWS_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_NEWS_LIMIT;
  return Math.min(MAX_NEWS_LIMIT, Math.max(1, Math.round(value)));
}

export function sortNewestFirst(items: MarketNewsItem[]): MarketNewsItem[] {
  return [...items].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function filterNewsForEquity(
  items: MarketNewsItem[],
  equity?: Equity,
): MarketNewsItem[] {
  if (!equity) return items;

  const assetId = equity.id.toLowerCase();
  const ticker = equity.ticker.toLowerCase();
  const nameParts = equity.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 3);

  return items.filter((item) => {
    const tickerMatches =
      item.ticker?.toLowerCase() === ticker ||
      containsToken(item.headline, ticker) ||
      containsToken(item.summary, ticker);
    if (tickerMatches) return true;

    const text = `${item.headline} ${item.summary ?? ''}`.toLowerCase();
    if (containsToken(text, assetId)) return true;

    return nameParts.some((part) => containsToken(text, part));
  });
}

function containsToken(value: string | undefined, token: string): boolean {
  if (!value || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(value);
}
