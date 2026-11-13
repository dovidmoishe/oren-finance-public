import type {
  SetupClass,
  StockAnalysis,
  TechnicalBrief,
  TrendRegime,
} from '../../../types/analysis';

export interface PlainTechnicalRead {
  lead: string;
  bullets: string[];
  details: string;
}

const REGIME_LABEL: Record<TrendRegime, string> = {
  uptrend: 'Uptrend',
  downtrend: 'Downtrend',
  range: 'Range',
};

const SETUP_LABEL: Record<SetupClass, string> = {
  continuation: 'Trend continuation',
  mean_reversion: 'Mean reversion',
  breakout: 'Breakout',
  insufficient: 'Insufficient history',
};

export function speechName(name: string | undefined, ticker: string): string {
  const cleaned = name
    ?.replace(
      /,?\s+(Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|N\.V\.|S\.A\.)$/i,
      '',
    )
    .trim();
  return cleaned || ticker;
}

export function plainTechnicalRead(input: {
  ticker: string;
  name?: string;
  opportunityScore: number;
  riskLabel?: StockAnalysis['riskLabel'];
  technicalBrief: TechnicalBrief;
}): PlainTechnicalRead {
  const { technicalBrief: brief } = input;
  const display = speechName(input.name, input.ticker);
  const daily = brief.primaryTimeframe;
  const price = referencePrice(brief);
  const support = brief.levels.find((level) => level.label === 'support');
  const resistance = brief.levels.find((level) => level.label === 'resistance');
  const buy = brief.limitZones?.find((zone) => zone.side === 'buy');
  const sell = brief.limitZones?.find((zone) => zone.side === 'sell');
  const stalling =
    brief.regime === 'uptrend' &&
    resistance !== undefined &&
    resistance.distancePct >= 0 &&
    resistance.distancePct < 1.5;

  let lead: string;
  if (brief.setup === 'insufficient') {
    lead = `${display} doesn't have enough price history for a solid read yet.`;
  } else if (stalling) {
    const entry = buy
      ? money(buy.preferredUsd)
      : support
        ? money(support.price)
        : undefined;
    lead = entry
      ? `${display} has been climbing and is right under a level where it often stalls (~${money(resistance.price)}). A dip toward ~${entry} would be a better entry.`
      : `${display} has been climbing and is right under a level where it often stalls (~${money(resistance.price)}).`;
  } else if (
    brief.regime === 'downtrend' &&
    support &&
    support.distancePct <= 0 &&
    support.distancePct > -1.5
  ) {
    lead = `${display} has been falling and is close to a level where buyers have stepped in before (~${money(support.price)}).`;
  } else if (brief.regime === 'range' && support && resistance) {
    lead = `${display} has been moving sideways between ~${money(support.price)} and ~${money(resistance.price)}.`;
  } else if (brief.regime === 'uptrend' && brief.setup === 'breakout') {
    lead = `${display} is pushing higher through the top of its recent range.`;
  } else if (brief.regime === 'uptrend') {
    lead = sell
      ? `${display} has been climbing, with selling interest near ~${money(sell.preferredUsd)}.`
      : `${display} has been climbing.`;
  } else if (brief.regime === 'downtrend') {
    lead = `${display} has been in a downtrend.`;
  } else {
    lead = `${display} doesn't have a strong trend either way right now.`;
  }

  const bullets: string[] = [];
  if (brief.setup !== 'insufficient') {
    if (brief.regime === 'uptrend' && !stalling) {
      bullets.push('The recent trend is still up.');
    } else if (brief.regime === 'downtrend') {
      bullets.push('The recent trend is down.');
    } else if (brief.regime === 'range') {
      bullets.push('Price has been chopping more than trending.');
    }
  }
  if (support && resistance && !stalling) {
    bullets.push(
      `Buyers have shown up near ${money(support.price)}, and it has stalled near ${money(resistance.price)}.`,
    );
  } else if (support && !lead.includes(money(support.price))) {
    bullets.push(`Buyers have shown up near ${money(support.price)}.`);
  } else if (resistance && !lead.includes(money(resistance.price))) {
    bullets.push(
      `It has had trouble getting through ${money(resistance.price)}.`,
    );
  }
  if (buy?.conservativeUsd && !lead.includes(money(buy.conservativeUsd))) {
    bullets.push(
      `A more cautious buy is closer to ${money(buy.conservativeUsd)}.`,
    );
  } else if (buy && !lead.includes(money(buy.preferredUsd))) {
    bullets.push(`A patient buy sits near ${money(buy.preferredUsd)}.`);
  }
  if (sell && !lead.includes(money(sell.preferredUsd))) {
    bullets.push(
      `Selling into strength lines up near ${money(sell.preferredUsd)}.`,
    );
  }
  if (
    price &&
    daily.sma20 > 0 &&
    (price - daily.sma20) / daily.sma20 > 0.06 &&
    brief.regime === 'uptrend'
  ) {
    bullets.push(
      "It's run well above its recent average, so chasing here is the risky part.",
    );
  }
  const weeklyRsi = brief.weeklyTimeframe?.rsi14;
  if (weeklyRsi !== undefined && weeklyRsi >= 70) {
    bullets.push('The longer-term picture is strong, but it looks stretched.');
  } else if (daily.rsi14 >= 70 && brief.setup !== 'insufficient') {
    bullets.push('Momentum looks hot, so a pause would be normal.');
  } else if (daily.rsi14 <= 30 && brief.setup !== 'insufficient') {
    bullets.push('Momentum looks washed out.');
  }
  if (brief.limitedHistory && brief.setup !== 'insufficient') {
    bullets.push('Daily history is thin, so treat this as a rough read.');
  }

  return {
    lead,
    bullets: bullets.slice(0, 5),
    details: detailsText(input),
  };
}

function detailsText(input: {
  opportunityScore: number;
  riskLabel?: StockAnalysis['riskLabel'];
  technicalBrief: TechnicalBrief;
}): string {
  const brief = input.technicalBrief;
  const daily = brief.primaryTimeframe;
  const lines = [
    `Regime: ${REGIME_LABEL[brief.regime]} (${daily.timeframe})`,
    `Setup: ${SETUP_LABEL[brief.setup]}`,
    `Oren Score: ${Math.round(input.opportunityScore)} (${input.riskLabel ?? 'unclassified'} risk)`,
    `Daily RSI14: ${formatNumber(daily.rsi14)}`,
    `MACD histogram: ${formatSigned(daily.macd.histogram)} (line ${formatNumber(daily.macd.line)}, signal ${formatNumber(daily.macd.signal)})`,
    `SMA20: ${formatNumber(daily.sma20)}  SMA50: ${formatNumber(daily.sma50)}`,
    `ATR14: ${formatNumber(daily.atr14)}`,
    `Bollinger middle ${formatNumber(daily.bollinger.middle)}, upper ${formatNumber(daily.bollinger.upper)}, lower ${formatNumber(daily.bollinger.lower)}, width ${formatNumber(daily.bollinger.bandwidth)}`,
  ];
  if (daily.volumeTrend !== undefined) {
    lines.push(`Volume trend: ${formatNumber(daily.volumeTrend)}`);
  }
  if (brief.weeklyTimeframe) {
    lines.push(`Weekly RSI14: ${formatNumber(brief.weeklyTimeframe.rsi14)}`);
  }
  for (const level of brief.levels) {
    lines.push(
      `${level.label}: ${formatNumber(level.price)} (${formatSigned(level.distancePct)}%)`,
    );
  }
  for (const zone of brief.limitZones ?? []) {
    const wings = [
      zone.conservativeUsd !== undefined
        ? `conservative ${formatNumber(zone.conservativeUsd)}`
        : undefined,
      zone.aggressiveUsd !== undefined
        ? `aggressive ${formatNumber(zone.aggressiveUsd)}`
        : undefined,
    ].filter(Boolean);
    lines.push(
      `${zone.side} zone preferred ${formatNumber(zone.preferredUsd)}${wings.length ? ` (${wings.join(', ')})` : ''} via ${zone.basis.replaceAll('_', ' ')}`,
    );
  }
  if (brief.risks.length) lines.push(`Notes: ${brief.risks.join(' ')}`);
  return lines.join('\n');
}

function referencePrice(brief: TechnicalBrief): number | undefined {
  for (const level of brief.levels) {
    if (!level.price || !Number.isFinite(level.distancePct)) continue;
    const price = level.price / (1 + level.distancePct / 100);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return undefined;
}

function money(value: number): string {
  if (!Number.isFinite(value)) return 'that level';
  if (Math.abs(value) >= 20) return `$${Math.round(value)}`;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return value.toFixed(2);
}

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}
