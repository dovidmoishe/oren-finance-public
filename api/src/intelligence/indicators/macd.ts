import { emaSeries } from './ema';

export interface MacdResult {
  line: number;
  signal: number;
  histogram: number;
}

/**
 * MACD 12/26/9 on closes. Returns neutral zeros if insufficient data.
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  if (closes.length < slowPeriod + signalPeriod) {
    return { line: 0, signal: 0, histogram: 0 };
  }

  const fast = emaSeries(closes, fastPeriod);
  const slow = emaSeries(closes, slowPeriod);
  const macdLine = fast.map((value, index) => value - slow[index]);
  const signal = emaSeries(macdLine, signalPeriod);
  const line = macdLine[macdLine.length - 1] ?? 0;
  const signalValue = signal[signal.length - 1] ?? 0;

  return {
    line,
    signal: signalValue,
    histogram: line - signalValue,
  };
}
