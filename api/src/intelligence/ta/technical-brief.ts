import type { TechnicalBrief } from '../../../types/analysis';
import type { MarketCandle } from '../../../types/market';
import type { MarketNewsItem } from '../../../types/news';
import { TA_MIN_DAILY_BARS } from '../../config/constants';
import { buildNewsOverlay } from './news-overlay';
import { buildLimitZones } from './limit-zones';
import { trendRegime } from './regime';
import { resampleWeekly } from './resample-weekly';
import { setupClass } from './setup';
import { swingLevels } from './swing-levels';
import { buildTimeframeSnapshot } from './timeframe-snapshot';

export function buildTechnicalBrief(input: {
  price: number;
  dailyBars: MarketCandle[];
  hourlyBars?: MarketCandle[];
  newsItems?: MarketNewsItem[];
}): TechnicalBrief {
  const dailyBars = [...input.dailyBars].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const hourlyBars = [...(input.hourlyBars ?? [])].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );

  const dailySnapshot = buildTimeframeSnapshot('daily', dailyBars);
  const weeklyBars = resampleWeekly(dailyBars);
  const weeklyTimeframe = buildTimeframeSnapshot('weekly', weeklyBars);
  const hourlyTimeframe =
    hourlyBars.length >= 20
      ? buildTimeframeSnapshot('hourly', hourlyBars)
      : undefined;

  const structureSnapshot = dailySnapshot ?? hourlyTimeframe;
  const primaryTimeframe = dailySnapshot ?? emptyDailySnapshot();
  const limitedHistory =
    dailyBars.length < TA_MIN_DAILY_BARS || dailySnapshot === undefined;
  const insufficientData = !dailySnapshot && !hourlyTimeframe;

  const regime = structureSnapshot
    ? trendRegime({
        price: input.price,
        sma20: structureSnapshot.sma20,
        sma50: structureSnapshot.sma50,
      })
    : trendRegime({
        price: input.price,
        sma20: primaryTimeframe.sma20,
        sma50: primaryTimeframe.sma50,
      });

  const levelBars =
    dailyBars.length >= TA_MIN_DAILY_BARS ? dailyBars : hourlyBars;
  const levels = swingLevels(levelBars, input.price);
  const support = levels.find((level) => level.label === 'support');
  const resistance = levels.find((level) => level.label === 'resistance');

  const setup = setupClass({
    regime,
    rsi14: structureSnapshot?.rsi14 ?? primaryTimeframe.rsi14,
    price: input.price,
    sma20: structureSnapshot?.sma20 ?? primaryTimeframe.sma20,
    bollinger: structureSnapshot?.bollinger ?? primaryTimeframe.bollinger,
    volumeTrend:
      structureSnapshot?.volumeTrend ?? primaryTimeframe.volumeTrend ?? 1,
    atr14: structureSnapshot?.atr14 ?? primaryTimeframe.atr14,
    resistanceDistancePct: resistance?.distancePct,
    supportDistancePct: support?.distancePct,
    limitedHistory: insufficientData,
  });
  const limitZones = buildLimitZones({
    price: input.price,
    levels,
    bollinger: structureSnapshot?.bollinger ?? primaryTimeframe.bollinger,
    atr14: structureSnapshot?.atr14 ?? primaryTimeframe.atr14,
  });
  const risks = buildRisks({
    limitedHistory,
    insufficientData,
    primaryTimeframe,
    setup,
  });

  const newsOverlay =
    input.newsItems && input.newsItems.length
      ? buildNewsOverlay(input.newsItems, regime)
      : undefined;

  return {
    regime,
    setup,
    primaryTimeframe,
    weeklyTimeframe,
    hourlyTimeframe,
    levels,
    limitZones: limitZones.length ? limitZones : undefined,
    risks,
    limitedHistory,
    newsOverlay,
  };
}

function buildRisks(input: {
  limitedHistory: boolean;
  insufficientData: boolean;
  primaryTimeframe: TechnicalBrief['primaryTimeframe'];
  setup: TechnicalBrief['setup'];
}): string[] {
  const risks: string[] = [];
  if (input.insufficientData) {
    risks.push('Insufficient OHLCV history for reliable indicator reads.');
  } else if (input.limitedHistory) {
    risks.push(
      'Daily history is thin — rely on hourly indicators for near-term context.',
    );
  }
  if (input.primaryTimeframe.atr14 > 0 && input.primaryTimeframe.sma20 > 0) {
    const atrPct =
      (input.primaryTimeframe.atr14 / input.primaryTimeframe.sma20) * 100;
    if (atrPct >= 4) {
      risks.push('Elevated daily ATR versus price.');
    }
  }
  if (input.primaryTimeframe.bollinger.bandwidth >= 12) {
    risks.push('Wide Bollinger bandwidth — price is moving fast.');
  }
  if (input.setup === 'breakout') {
    risks.push('Breakout setups can fail if volume does not follow through.');
  }
  if (
    input.primaryTimeframe.rsi14 >= 70 ||
    input.primaryTimeframe.rsi14 <= 30
  ) {
    risks.push('RSI is at an extreme — reversals are more likely.');
  }
  return risks.slice(0, 4);
}

function emptyDailySnapshot(): TechnicalBrief['primaryTimeframe'] {
  return {
    timeframe: 'daily',
    rsi14: 50,
    sma20: 0,
    sma50: 0,
    macd: { line: 0, signal: 0, histogram: 0 },
    atr14: 0,
    bollinger: { upper: 0, middle: 0, lower: 0, bandwidth: 0 },
    volumeTrend: 1,
  };
}
