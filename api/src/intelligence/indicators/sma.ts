/**
 * Simple moving average of the last `period` closes.
 * Returns last close (or 0) if insufficient data.
 */
export function sma(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  if (closes.length < period) {
    return closes[closes.length - 1];
  }
  const slice = closes.slice(closes.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}
