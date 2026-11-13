import { sma } from './sma';

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

/**
 * Bollinger bands (SMA middle, 2 standard deviations).
 */
export function bollinger(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerResult {
  if (closes.length === 0) {
    return { upper: 0, middle: 0, lower: 0, bandwidth: 0 };
  }

  const middle = sma(closes, period);
  if (closes.length < period || middle === 0) {
    return { upper: middle, middle, lower: middle, bandwidth: 0 };
  }

  const slice = closes.slice(-period);
  const variance =
    slice.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
  const deviation = Math.sqrt(variance);
  const upper = middle + stdDevMultiplier * deviation;
  const lower = middle - stdDevMultiplier * deviation;
  const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

  return { upper, middle, lower, bandwidth };
}
