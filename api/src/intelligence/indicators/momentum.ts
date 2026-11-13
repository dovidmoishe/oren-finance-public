/**
 * Percent return over `lookback` bars: (last - past) / past * 100.
 * Returns 0 if insufficient data.
 */
export function momentum(closes: number[], lookback: number): number {
  if (closes.length < lookback + 1) return 0;
  const latest = closes[closes.length - 1];
  const past = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(latest) || !Number.isFinite(past) || past === 0) {
    return 0;
  }
  return ((latest - past) / past) * 100;
}
