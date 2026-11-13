import type { SetupClass, TrendRegime } from '../../../types/analysis';
import type { BollingerResult } from '../indicators/bollinger';

/**
 * A swing that still sits inside a fraction of a day's range has not
 * been cleared. Calling that a breakout contradicts "buy the dip at
 * support" — price is stalling under supply, not breaking out.
 */
function nearbyRoomPct(price: number, atr14: number | undefined): number {
  if (!(price > 0) || !(atr14 && atr14 > 0)) return 1;
  return Math.max(0.75, (atr14 / price) * 25);
}

function levelStillInFront(
  distancePct: number | undefined,
  roomPct: number,
  side: 'above' | 'below',
): boolean {
  if (distancePct === undefined || !Number.isFinite(distancePct)) return false;
  if (side === 'above') return distancePct >= 0 && distancePct < roomPct;
  return distancePct <= 0 && distancePct > -roomPct;
}

export function setupClass(input: {
  regime: TrendRegime;
  rsi14: number;
  price: number;
  sma20: number;
  bollinger: BollingerResult;
  volumeTrend: number;
  limitedHistory: boolean;
  atr14?: number;
  resistanceDistancePct?: number;
  supportDistancePct?: number;
}): SetupClass {
  if (input.limitedHistory) return 'insufficient';

  const { regime, rsi14, price, sma20, bollinger, volumeTrend } = input;
  const nearUpper =
    bollinger.upper > 0 &&
    price >= bollinger.upper * 0.985 &&
    volumeTrend >= 1.15;
  const nearLower =
    bollinger.lower > 0 &&
    price <= bollinger.lower * 1.015 &&
    volumeTrend >= 1.15;
  const room = nearbyRoomPct(price, input.atr14);

  if (
    nearUpper &&
    !levelStillInFront(input.resistanceDistancePct, room, 'above')
  ) {
    return 'breakout';
  }
  if (
    nearLower &&
    !levelStillInFront(input.supportDistancePct, room, 'below')
  ) {
    return 'breakout';
  }

  if (regime === 'range' && (rsi14 >= 70 || rsi14 <= 30)) {
    return 'mean_reversion';
  }

  if (
    (regime === 'uptrend' || regime === 'downtrend') &&
    rsi14 >= 35 &&
    rsi14 <= 70 &&
    sma20 > 0 &&
    Math.abs((price - sma20) / sma20) <= 0.04
  ) {
    return 'continuation';
  }

  if (regime === 'range') return 'mean_reversion';
  return 'continuation';
}
