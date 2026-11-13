/**
 * Wilder RSI over `period` (default 14).
 * Returns 50 (neutral) if insufficient data.
 */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }

  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
