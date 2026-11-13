/**
 * Deterministic indicator set for a canonical equity.
 * Computed by the intelligence engine — never invented by the LLM.
 */
export interface StockSignals {
  assetId: string;
  ticker: string;
  momentum7d: number;
  momentum30d: number;
  volatility30d: number;
  volumeTrend: number;
  rsi14: number;
  sma20: number;
  sma50: number;
  liquidityScore: number;
  activityScore: number;
  /** Normalized Oren opportunity score, 0–100. */
  opportunityScore: number;
  calculatedAt: Date;
}

export interface ScoreDimensions {
  momentum: number;
  trend: number;
  volume: number;
  volatility: number;
  liquidity: number;
  activity: number;
  relativeStrength?: number;
}
