import type { TimeframeIndicators } from '../../../types/analysis';
import type { MarketCandle } from '../../../types/market';
import { atr } from '../indicators/atr';
import { bollinger } from '../indicators/bollinger';
import { macd } from '../indicators/macd';
import { momentum } from '../indicators/momentum';
import { rsi } from '../indicators/rsi';
import { sma } from '../indicators/sma';
import { volumeTrend } from '../indicators/volume-trend';

export function buildTimeframeSnapshot(
  timeframe: TimeframeIndicators['timeframe'],
  bars: MarketCandle[],
): TimeframeIndicators | undefined {
  if (bars.length < 20) return undefined;

  const closes = bars.map((bar) => bar.close).filter((value) => Number.isFinite(value));
  const volumes = bars.map((bar) => bar.volume ?? 0);
  if (closes.length < 20) return undefined;

  const bands = bollinger(closes, 20, 2);
  const macdValues = macd(closes);
  const snapshot: TimeframeIndicators = {
    timeframe,
    rsi14: round(rsi(closes, 14)),
    sma20: round(sma(closes, 20)),
    sma50: round(sma(closes, 50)),
    macd: {
      line: round(macdValues.line),
      signal: round(macdValues.signal),
      histogram: round(macdValues.histogram),
    },
    atr14: round(atr(bars, 14)),
    bollinger: {
      upper: round(bands.upper),
      middle: round(bands.middle),
      lower: round(bands.lower),
      bandwidth: round(bands.bandwidth),
    },
    volumeTrend: round(volumeTrend(volumes, 7)),
  };

  if (closes.length >= 200) {
    snapshot.sma200 = round(sma(closes, 200));
  }

  if (timeframe === 'daily') {
    snapshot.momentum7d = round(momentum(closes, 7));
    snapshot.momentum30d = round(momentum(closes, 30));
  }

  return snapshot;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
