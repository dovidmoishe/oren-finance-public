import type { ScoreDimensions } from '../../../types/signals';

export const SCORE_WEIGHTS = {
  momentum: 0.25,
  trend: 0.2,
  volume: 0.15,
  volatility: 0.1,
  liquidity: 0.15,
  activity: 0.15,
} as const;

export interface ScoreInput {
  momentum7d: number;
  momentum30d: number;
  /** Latest close. */
  price: number;
  sma20: number;
  sma50: number;
  volumeTrend: number;
  /** Realized vol percent (e.g. 2.5). */
  volatility30d: number;
  /** Already 0–100-ish liquidity score from Tokens meta. */
  liquidityScore: number;
  /** Already 0–100-ish activity score from Tokens meta. */
  activityScore: number;
  /** True when OHLCV history is thin (< 30 bars). */
  limitedHistory?: boolean;
}

function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(max, Math.max(min, n));
}

/** Map percent return (~-20..+20) onto 0–100. */
function momentumDimension(m7: number, m30: number): number {
  const blended = m7 * 0.6 + m30 * 0.4;
  return clamp(50 + blended * 2.5);
}

/** Price vs SMAs. */
function trendDimension(price: number, sma20: number, sma50: number): number {
  if (!price || !sma20) return 50;
  let score = 50;
  if (price > sma20) score += 15;
  else score -= 15;
  if (sma20 > sma50 && sma50 > 0) score += 20;
  else if (sma20 < sma50 && sma50 > 0) score -= 15;
  const dist = ((price - sma20) / sma20) * 100;
  score += clamp(dist, -10, 10);
  return clamp(score);
}

/** Volume trend ratio → 0–100. */
function volumeDimension(trend: number): number {
  // 1.0 → 50, 1.5 → ~75, 0.5 → ~25
  return clamp(50 + (trend - 1) * 50);
}

/** Higher realized vol lowers this dimension. */
function volatilityDimension(volPct: number): number {
  // ~1% daily → high quality; ~5%+ → poor
  return clamp(100 - volPct * 12);
}

export function computeOpportunityScore(input: ScoreInput): {
  score: number;
  dimensions: ScoreDimensions;
} {
  const dimensions: ScoreDimensions = {
    momentum: input.limitedHistory
      ? 50
      : momentumDimension(input.momentum7d, input.momentum30d),
    trend: input.limitedHistory
      ? 50
      : trendDimension(input.price, input.sma20, input.sma50),
    volume: input.limitedHistory ? 50 : volumeDimension(input.volumeTrend),
    volatility: input.limitedHistory
      ? 50
      : volatilityDimension(input.volatility30d),
    liquidity: clamp(input.liquidityScore),
    activity: clamp(input.activityScore),
  };

  const score =
    dimensions.momentum * SCORE_WEIGHTS.momentum +
    dimensions.trend * SCORE_WEIGHTS.trend +
    dimensions.volume * SCORE_WEIGHTS.volume +
    dimensions.volatility * SCORE_WEIGHTS.volatility +
    dimensions.liquidity * SCORE_WEIGHTS.liquidity +
    dimensions.activity * SCORE_WEIGHTS.activity;

  return { score: Math.round(clamp(score) * 100) / 100, dimensions };
}
