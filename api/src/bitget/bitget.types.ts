interface BitgetEnvelope<T> {
  code?: string;
  msg?: string;
  requestTime?: number;
  data?: T;
}

export interface BitgetRealityStockRaw {
  symbol?: string;
  code?: string;
  name?: string;
  tradingPeriod?: string[] | string;
  weekendTradable?: string;
}

export interface BitgetTickerRaw {
  symbol?: string;
  lastPrice?: string;
  openPrice24h?: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  ask1Price?: string;
  bid1Price?: string;
  price24hPcnt?: string;
  turnover24h?: string;
  volume24h?: string;
  platformTurnover24h?: string;
  ts?: string;
}

export type BitgetCandleRaw = Array<string | number>;

export interface BitgetMarketStateRaw {
  market?: string;
  daylightType?: string;
  stateList?: Array<{
    state?: string;
    timeZone?: string;
    startTime?: string;
    endTime?: string;
  }>;
}

export type BitgetApiEnvelope<T> = BitgetEnvelope<T>;
