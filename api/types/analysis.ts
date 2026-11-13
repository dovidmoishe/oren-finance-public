import type { MarketNewsItem } from './news';
import type { StockSignals } from './signals';

export type TrendRegime = 'uptrend' | 'downtrend' | 'range';

export type SetupClass =
  | 'continuation'
  | 'mean_reversion'
  | 'breakout'
  | 'insufficient';

export type NewsAlignment = 'with_regime' | 'against_regime' | 'neutral';

export interface PriceLevel {
  price: number;
  label: 'support' | 'resistance';
  /** Signed percent distance from current price to the level. */
  distancePct: number;
}

export type LimitZoneSide = 'buy' | 'sell';

export type LimitZoneBasis =
  | 'swing_support'
  | 'swing_resistance'
  | 'bollinger_lower'
  | 'bollinger_upper';

/** Deterministic limit-order price suggestion derived from TA structure. */
export interface LimitZone {
  side: LimitZoneSide;
  preferredUsd: number;
  conservativeUsd?: number;
  aggressiveUsd?: number;
  basis: LimitZoneBasis;
  distancePct: number;
}

export interface MacdSnapshot {
  line: number;
  signal: number;
  histogram: number;
}

export interface BollingerSnapshot {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

export interface TimeframeIndicators {
  timeframe: 'daily' | 'weekly' | 'hourly';
  rsi14: number;
  sma20: number;
  sma50: number;
  sma200?: number;
  macd: MacdSnapshot;
  atr14: number;
  bollinger: BollingerSnapshot;
  volumeTrend?: number;
  momentum7d?: number;
  momentum30d?: number;
}

export interface NewsOverlayItem {
  headline: string;
  alignment: NewsAlignment;
  publishedAt: Date;
  url?: string;
}

/** Deterministic technical-analysis brief — LLM explains, never invents. */
export interface TechnicalBrief {
  regime: TrendRegime;
  setup: SetupClass;
  primaryTimeframe: TimeframeIndicators;
  weeklyTimeframe?: TimeframeIndicators;
  hourlyTimeframe?: TimeframeIndicators;
  levels: PriceLevel[];
  /** Suggested limit-order zones from S/R (and Bollinger fallback). */
  limitZones?: LimitZone[];
  risks: string[];
  limitedHistory: boolean;
  newsOverlay?: NewsOverlayItem[];
}

/**
 * Structured quantitative analysis for a canonical equity.
 * Signals are computed deterministically; narrative explains them.
 */
export interface StockAnalysis {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  signals: StockSignals;
  /** Short human-readable drivers behind the score. */
  highlights: string[];
  /** Deterministic TA paragraph derived from technicalBrief. */
  summary?: string;
  technicalBrief?: TechnicalBrief;
  riskLabel?: 'low' | 'moderate' | 'elevated' | 'high';
  news?: MarketNewsItem[];
  analyzedAt: Date;
}

/** Ranked opportunity row for markets discovery. */
export interface StockOpportunity {
  assetId: string;
  ticker: string;
  name: string;
  logo?: string;
  opportunityScore: number;
  price: number;
  priceChange24h: number;
  highlights: string[];
  signals: Pick<
    StockSignals,
    | 'momentum7d'
    | 'momentum30d'
    | 'volatility30d'
    | 'rsi14'
    | 'volumeTrend'
    | 'liquidityScore'
    | 'activityScore'
  >;
}
