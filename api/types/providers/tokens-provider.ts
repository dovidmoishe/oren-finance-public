import type { Equity, TokenizedEquity } from '../equity';
import type { ChartRange, MarketCandle, OhlcvBar } from '../market';

/** Re-exported from Nest chart-range util for provider typing. */
export type ChartWindow = {
  interval: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W';
  from: number;
  to: number;
};
import type { MarketNewsItem, EquityRisk } from '../news';

/**
 * Tokens API service surface (Nest TokensService).
 * Rest of Oren consumes normalized domain objects — not raw Tokens responses.
 */
export interface TokensService {
  getStocks(): Promise<Equity[]>;

  searchStocks(query: string): Promise<Equity[]>;

  getStock(assetId: string): Promise<Equity>;

  getVariants(assetId: string): Promise<TokenizedEquity[]>;

  resolveMint(mint: string): Promise<Equity | null>;

  getCurrentMarketData(assetId: string): Promise<Equity>;

  getPriceChart(assetId: string, range: ChartRange): Promise<MarketCandle[]>;

  getCandlesForWindow(
    assetId: string,
    window: ChartWindow,
  ): Promise<MarketCandle[]>;

  getOHLCV(
    assetId: string,
    params?: { start?: Date; end?: Date; timeframe?: string; mint?: string },
  ): Promise<OhlcvBar[]>;

  getTrendingStocks(): Promise<Equity[]>;

  getRisk(assetId: string): Promise<EquityRisk>;

  getNews(assetId?: string): Promise<MarketNewsItem[]>;
}
