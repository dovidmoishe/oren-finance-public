import type { StockOpportunity } from './analysis';
import type { EquityCategory } from './equity';

export type ChartRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

/** Normalized candle for Lightweight Charts (from Tokens API via Nest). */
export interface MarketCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface OhlcvBar extends MarketCandle {
  assetId: string;
  ticker?: string;
  vwap?: number;
}

export interface ChartSeries {
  assetId: string;
  ticker: string;
  range: ChartRange;
  candles: MarketCandle[];
}

export interface MarketMover {
  assetId: string;
  ticker: string;
  name: string;
  logo?: string;
  category?: EquityCategory;
  price: number;
  priceChange24h: number;
  volume24h?: number;
}

export interface MarketsOverview {
  trending: MarketMover[];
  topMovers: MarketMover[];
  opportunities: StockOpportunity[];
}
