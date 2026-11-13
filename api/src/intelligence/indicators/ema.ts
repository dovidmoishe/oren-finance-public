/**
 * Exponential moving average of the last value in the series.
 */
export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  const multiplier = 2 / (period + 1);
  let current =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

  for (let index = period; index < values.length; index++) {
    current = values[index] * multiplier + current * (1 - multiplier);
  }

  return current;
}

/**
 * Full EMA series aligned with input length (leading values use expanding SMA).
 */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];

  const multiplier = 2 / (period + 1);
  const series: number[] = [];
  let current = values[0];

  for (let index = 0; index < values.length; index++) {
    if (index === 0) {
      current = values[index];
    } else if (index < period) {
      current =
        values.slice(0, index + 1).reduce((sum, value) => sum + value, 0) /
        (index + 1);
    } else {
      current = values[index] * multiplier + current * (1 - multiplier);
    }
    series.push(current);
  }

  return series;
}
