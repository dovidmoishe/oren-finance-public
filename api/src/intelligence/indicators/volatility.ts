/**
 * Realized volatility as stdev of daily returns over `lookback` periods,
 * expressed as a percent (not annualized). Returns 0 if insufficient data.
 */
export function volatility(closes: number[], lookback = 30): number {
  if (closes.length < lookback + 1) return 0;

  const returns: number[] = [];
  const start = closes.length - lookback;
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (!prev) continue;
    returns.push((closes[i] - prev) / prev);
  }
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * 100;
}
