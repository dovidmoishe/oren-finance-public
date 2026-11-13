import type { TrendRegime } from '../../../types/analysis';

export function trendRegime(input: {
  price: number;
  sma20: number;
  sma50: number;
}): TrendRegime {
  const { price, sma20, sma50 } = input;
  if (!price || !sma20 || !sma50) return 'range';

  if (price > sma50 && sma20 > sma50) return 'uptrend';
  if (price < sma50 && sma20 < sma50) return 'downtrend';
  return 'range';
}
