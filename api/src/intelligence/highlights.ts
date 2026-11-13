import type { ScoreDimensions } from '../../types/signals';
import type { StockSignals } from '../../types/signals';

/**
 * Deterministic highlight strings from signals + score dimensions.
 */
export function buildHighlights(
  signals: Pick<
    StockSignals,
    | 'momentum7d'
    | 'momentum30d'
    | 'rsi14'
    | 'sma20'
    | 'sma50'
    | 'volumeTrend'
    | 'liquidityScore'
    | 'volatility30d'
  >,
  dimensions: ScoreDimensions,
  opts?: { limitedHistory?: boolean; price?: number },
): string[] {
  const highlights: string[] = [];

  if (opts?.limitedHistory) {
    highlights.push('Limited history');
  }

  if (signals.momentum7d >= 5) {
    highlights.push('Strong 7d momentum');
  } else if (signals.momentum7d <= -5) {
    highlights.push('Weak 7d momentum');
  }

  if (signals.momentum30d >= 8) {
    highlights.push('Strong 30d momentum');
  }

  const price = opts?.price;
  if (price !== undefined && signals.sma50 > 0) {
    if (price > signals.sma50) highlights.push('Above SMA50');
    else highlights.push('Below SMA50');
  }

  if (signals.sma20 > 0 && signals.sma50 > 0) {
    if (signals.sma20 > signals.sma50) highlights.push('Uptrend (SMA20 > SMA50)');
    else if (signals.sma20 < signals.sma50) {
      highlights.push('Downtrend (SMA20 < SMA50)');
    }
  }

  if (signals.rsi14 >= 70) highlights.push('RSI overbought');
  else if (signals.rsi14 <= 30) highlights.push('RSI oversold');

  if (signals.volumeTrend >= 1.3) highlights.push('Rising volume');
  else if (signals.volumeTrend <= 0.7) highlights.push('Falling volume');

  if (dimensions.liquidity < 35) highlights.push('Thin liquidity');
  else if (dimensions.liquidity >= 70) highlights.push('Strong liquidity');

  if (signals.volatility30d >= 4) highlights.push('Elevated volatility');

  if (dimensions.momentum >= 70 && dimensions.trend >= 65) {
    highlights.push('Momentum + trend aligned');
  }

  return highlights.slice(0, 6);
}

export function riskLabelFromVolatility(
  volatility30d: number,
  tokensRiskLevel?: string,
): 'low' | 'moderate' | 'elevated' | 'high' {
  const normalized = tokensRiskLevel?.toLowerCase();
  if (
    normalized === 'low' ||
    normalized === 'moderate' ||
    normalized === 'elevated' ||
    normalized === 'high'
  ) {
    return normalized;
  }
  if (volatility30d < 1.5) return 'low';
  if (volatility30d < 3) return 'moderate';
  if (volatility30d < 5) return 'elevated';
  return 'high';
}
