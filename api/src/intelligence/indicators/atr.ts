import type { MarketCandle } from '../../../types/market';

/**
 * Average true range over `period` bars (simple mean of TR).
 */
export function atr(bars: MarketCandle[], period = 14): number {
  if (bars.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let index = 1; index < bars.length; index++) {
    const current = bars[index];
    const previous = bars[index - 1];
    const range = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trueRanges.push(range);
  }

  const slice = trueRanges.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}
