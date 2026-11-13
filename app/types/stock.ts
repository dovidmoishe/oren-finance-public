export type ChartRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

export interface TokenizedEquityVariant {
  mint: string;
  symbol: string;
  name: string;
  issuer?: string;
  decimals?: number;
  liquidity?: number;
  liquidityTier?: string;
  trustTier?: string;
  tradable: boolean;
}

export interface StockSummary {
  assetId: string;
  ticker: string;
  name: string;
  logoUrl?: string;
  category?: "equity" | "etf" | "index";
  priceUsd?: number;
  change24hPct?: number;
  volume24hUsd?: number;
  liquidityUsd?: number;
  opportunityScore?: number;
}

export interface StocksPage {
  items: StockSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface StockDetail extends StockSummary {
  sector?: string;
  variants: TokenizedEquityVariant[];
}

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface StockSignals {
  assetId: string;
  ticker: string;
  momentum7d?: number;
  momentum30d?: number;
  volatility30d?: number;
  volumeTrend?: number;
  rsi14?: number;
  sma20?: number;
  sma50?: number;
  liquidityScore?: number;
  activityScore?: number;
  opportunityScore: number;
  calculatedAt: string;
}

export type TrendRegime = "uptrend" | "downtrend" | "range";

export type SetupClass =
  | "continuation"
  | "mean_reversion"
  | "breakout"
  | "insufficient";

export type NewsAlignment = "with_regime" | "against_regime" | "neutral";

export interface PriceLevel {
  price: number;
  label: "support" | "resistance";
  distancePct: number;
}

export type LimitZoneSide = "buy" | "sell";

export type LimitZoneBasis =
  | "swing_support"
  | "swing_resistance"
  | "bollinger_lower"
  | "bollinger_upper";

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
  timeframe: "daily" | "weekly" | "hourly";
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
  publishedAt: string;
  url?: string;
}

export interface TechnicalBrief {
  regime: TrendRegime;
  setup: SetupClass;
  primaryTimeframe: TimeframeIndicators;
  weeklyTimeframe?: TimeframeIndicators;
  hourlyTimeframe?: TimeframeIndicators;
  levels: PriceLevel[];
  limitZones?: LimitZone[];
  risks: string[];
  limitedHistory: boolean;
  newsOverlay?: NewsOverlayItem[];
}

export interface StockAnalysis {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  summary?: string;
  technicalBrief?: TechnicalBrief;
  signals: StockSignals;
  highlights: string[];
  riskLabel?: "low" | "moderate" | "elevated" | "high";
  analyzedAt: string;
}

export interface NewsItem {
  id: string;
  assetId?: string;
  ticker?: string;
  headline: string;
  source?: string;
  url?: string;
  summary?: string;
  publishedAt: string;
  imageUrl?: string;
}
