import type { Equity } from '../equity';
import type { ChartRange, MarketCandle } from '../market';
import type { MarketNewsItem } from '../news';

/**
 * Market / equity data provider abstraction.
 * MVP implementation: TokensMarketDataProvider.
 * Prevents the app from depending directly on one external API.
 */
export interface MarketDataProvider {
  searchEquities(query: string): Promise<Equity[]>;

  getEquity(id: string): Promise<Equity>;

  getPrice(id: string): Promise<number>;

  getChart(id: string, range: ChartRange): Promise<MarketCandle[]>;

  getNews(id: string): Promise<MarketNewsItem[]>;
}
