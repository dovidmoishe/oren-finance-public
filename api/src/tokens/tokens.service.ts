import { Injectable } from '@nestjs/common';
import type { Equity, TokenizedEquity } from '../../types/equity';
import type { ChartRange, MarketCandle, OhlcvBar } from '../../types/market';
import type { EquityRisk, MarketNewsItem } from '../../types/news';
import type { TokensService as TokensServiceContract } from '../../types/providers/tokens-provider';
import { TokensNotFoundError } from '../common/errors/provider.errors';
import { chartRangeToWindow, type ChartWindow } from './chart-range.util';
import { TokensClient } from './tokens.client';
import {
  extractAssetList,
  extractCandles,
  extractNews,
  isEquityAsset,
  mapCandles,
  mapEquity,
  mapEquityList,
  mapNewsFeed,
  mapOhlcv,
  mapRisk,
  mapVariants,
} from './tokens.mapper';
import type {
  TokensAssetRaw,
  TokensCuratedRaw,
  TokensResolveRaw,
  TokensRiskRaw,
  TokensVariantsRaw,
  TokensMarketSnapshotRaw,
} from './tokens.types';

@Injectable()
export class TokensService implements TokensServiceContract {
  constructor(private readonly client: TokensClient) {}

  async getStocks(): Promise<Equity[]> {
    const raw = await this.client.get<unknown>('/assets/curated', {
      list: 'stocks',
      groupBy: 'asset',
    });
    return mapEquityList(extractAssetList(raw));
  }

  async getStocksPage(
    offset: number,
    limit: number,
  ): Promise<{
    stocks: Equity[];
    total: number;
    hasMore: boolean;
  }> {
    const raw = await this.client.get<TokensCuratedRaw>('/assets/curated', {
      list: 'stocks',
      groupBy: 'asset',
      offset,
      limit,
    });
    const stocks = mapEquityList(extractAssetList(raw));
    const total = raw.pagination?.total ?? offset + stocks.length;
    const hasMore = raw.pagination?.hasMore ?? offset + stocks.length < total;

    return { stocks, total, hasMore };
  }

  async searchStocks(query: string): Promise<Equity[]> {
    const raw = await this.client.get<unknown>('/assets/search', {
      q: query,
      variants: 'all',
      limit: 20,
    });
    return mapEquityList(extractAssetList(raw));
  }

  async getStock(assetId: string): Promise<Equity> {
    const raw = await this.client.get<TokensAssetRaw>(
      `/assets/${encodeURIComponent(assetId)}`,
      { include: 'profile,risk' },
    );
    if (!isEquityAsset(raw)) {
      throw new TokensNotFoundError(`Equity asset not found: ${assetId}`);
    }
    const equity = mapEquity(raw);
    if (!equity.id) {
      throw new TokensNotFoundError(`Asset not found: ${assetId}`);
    }
    return equity;
  }

  async getVariants(assetId: string): Promise<TokenizedEquity[]> {
    const raw = await this.client.get<TokensVariantsRaw>(
      `/assets/${encodeURIComponent(assetId)}/variants`,
      { kind: 'tokenized_equity' },
    );
    return mapVariants(raw.variants);
  }

  async resolveMint(mint: string): Promise<Equity | null> {
    try {
      const resolved = await this.client.get<TokensResolveRaw>(
        '/assets/resolve',
        { mint },
      );
      const assetId = resolved.assetId ?? resolved.asset?.assetId;
      if (!assetId) return null;
      return await this.getStock(assetId);
    } catch (err) {
      if (err instanceof TokensNotFoundError) return null;
      throw err;
    }
  }

  async getCurrentMarketData(assetId: string): Promise<Equity> {
    return this.getStock(assetId);
  }

  async getPriceChart(
    assetId: string,
    range: ChartRange,
  ): Promise<MarketCandle[]> {
    return this.getCandlesForWindow(assetId, chartRangeToWindow(range));
  }

  /**
   * Same candle path as stock charts: price-chart first, then OHLCV with the
   * best tradable mint. Intelligence/TA must use this instead of raw OHLCV.
   */
  async getCandlesForWindow(
    assetId: string,
    window: ChartWindow,
  ): Promise<MarketCandle[]> {
    const raw = await this.client.get<unknown>(
      `/assets/${encodeURIComponent(assetId)}/price-chart`,
      {
        interval: window.interval,
        from: window.from,
        to: window.to,
      },
    );
    const candles = mapCandles(extractCandles(raw));
    if (candles.length > 0) return candles;

    const equity = await this.getStock(assetId).catch(() => null);
    const variant = equity?.variants
      .filter((item) => item.tradable && item.mint)
      .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))[0];

    const ohlcv = await this.getOHLCV(assetId, {
      start: new Date(window.from * 1000),
      end: new Date(window.to * 1000),
      timeframe: window.interval,
      mint: variant?.mint,
    });
    return ohlcv.map(({ timestamp, open, high, low, close, volume }) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }));
  }

  async getOHLCV(
    assetId: string,
    params?: { start?: Date; end?: Date; timeframe?: string; mint?: string },
  ): Promise<OhlcvBar[]> {
    const to = Math.floor((params?.end ?? new Date()).getTime() / 1000);
    const from = Math.floor(
      (
        params?.start ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      ).getTime() / 1000,
    );
    const raw = await this.client.get<unknown>(
      `/assets/${encodeURIComponent(assetId)}/ohlcv`,
      {
        interval: params?.timeframe ?? '1H',
        from,
        to,
        mint: params?.mint,
      },
    );
    return mapOhlcv(assetId, extractCandles(raw));
  }

  async getTrendingStocks(): Promise<Equity[]> {
    const raw = await this.client.get<unknown>('/assets/trending', {
      category: 'equity',
      limit: 50,
    });
    return mapEquityList(extractAssetList(raw));
  }

  async getRisk(assetId: string): Promise<EquityRisk> {
    const raw = await this.client.get<TokensRiskRaw>(
      `/assets/${encodeURIComponent(assetId)}/risk-summary`,
    );
    return mapRisk(assetId, assetId.toUpperCase(), raw);
  }

  async getNews(assetId?: string): Promise<MarketNewsItem[]> {
    const query: Record<string, string | number | undefined> = {};
    if (assetId) query.assetId = assetId;
    const raw = await this.client.get<unknown>('/news/feed', query);
    return mapNewsFeed(extractNews(raw));
  }

  /** Phase 1 helper — bulk mint pricing (max 250). */
  async getMarketSnapshots(
    mints: string[],
  ): Promise<TokensMarketSnapshotRaw[]> {
    if (mints.length === 0) return [];
    const raw = await this.client.post<{
      results?: TokensMarketSnapshotRaw[];
      snapshots?: TokensMarketSnapshotRaw[];
    }>('/assets/market-snapshots', { mints: mints.slice(0, 250) });
    return raw.results ?? raw.snapshots ?? [];
  }

  /** Phase 1 helper — batch variant markets (max 50). */
  async getVariantMarkets(mints: string[]): Promise<unknown> {
    if (mints.length === 0) return [];
    return this.client.get('/assets/variant-markets', {
      mints: mints.slice(0, 50).join(','),
    });
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    return this.client.getHealth();
  }
}
