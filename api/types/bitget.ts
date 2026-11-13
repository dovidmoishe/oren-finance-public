import type { ChartRange, MarketCandle } from './market';

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

export interface BitgetMarketSession {
  state: string;
  timeZone: string;
  startTime: string;
  endTime: string;
}

export interface BitgetTradingContext {
  supportedPeriods: string[];
  weekendTradable: boolean;
  daylightType?: string;
  sessions: BitgetMarketSession[];
}

export interface BitgetPriceComparison {
  orenReferencePriceUsd: number;
  bitgetPriceUsd: number;
  differencePct: number;
}

export interface BitgetMarketContext {
  available: boolean;
  assetId: string;
  ticker: string;
  symbol?: string;
  range: ChartRange;
  quote?: BitgetMarketQuote;
  /** Full provider count before the agent payload is capped to recent bars. */
  totalCandleCount?: number;
  candles: MarketCandle[];
  trading?: BitgetTradingContext;
  comparison?: BitgetPriceComparison;
  reason?: 'BITGET_REALITY_SYMBOL_UNAVAILABLE' | 'BITGET_UNAVAILABLE';
  warnings?: string[];
  source: {
    provider: 'Bitget';
    product: 'Reality';
    observedAt: Date;
    stale: boolean;
  };
}
