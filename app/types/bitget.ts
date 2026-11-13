import type { ChartRange, MarketCandle } from './stock';

export interface BitgetMarketQuote {
  lastPriceUsd: number;
  open24hUsd?: number;
  high24hUsd?: number;
  low24hUsd?: number;
  change24hPct?: number;
  volume24h?: number;
  turnover24hUsd?: number;
  platformTurnover24hUsd?: number;
  bidUsd?: number;
  askUsd?: number;
  spreadBps?: number;
}

export interface BitgetMarketContext {
  available: boolean;
  assetId: string;
  ticker: string;
  symbol?: string;
  range: ChartRange;
  quote?: BitgetMarketQuote;
  totalCandleCount?: number;
  candles: MarketCandle[];
  trading?: {
    supportedPeriods: string[];
    weekendTradable: boolean;
    daylightType?: string;
    sessions: Array<{
      state: string;
      timeZone: string;
      startTime: string;
      endTime: string;
    }>;
  };
  comparison?: {
    orenReferencePriceUsd: number;
    bitgetPriceUsd: number;
    differencePct: number;
  };
  reason?: 'BITGET_REALITY_SYMBOL_UNAVAILABLE' | 'BITGET_UNAVAILABLE';
  warnings?: string[];
  source: {
    provider: 'Bitget';
    product: 'Reality';
    observedAt: string;
    stale: boolean;
  };
}
