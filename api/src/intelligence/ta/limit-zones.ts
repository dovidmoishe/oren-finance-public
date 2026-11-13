import type {
  BollingerSnapshot,
  LimitZone,
  PriceLevel,
} from '../../../types/analysis';

const ATR_BUFFER_FRACTION = 0.25;

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function distancePct(price: number, level: number): number {
  if (!price || !level) return 0;
  return ((level - price) / price) * 100;
}

/**
 * Buy ladder: conservative < preferred < aggressive < price.
 * Sell ladder: price < aggressive < preferred < conservative.
 * Both wings use the same ATR offset. A wing that would cross the
 * market is omitted — clamping it to the live price makes that side
 * a few cents wide while the other side keeps the full offset.
 */
function offsetLevel(
  preferred: number,
  offset: number,
  price: number,
  side: 'buy' | 'sell',
  wing: 'toward' | 'away',
): number | undefined {
  if (!(offset > 0)) return undefined;
  const signed =
    side === 'buy'
      ? wing === 'toward'
        ? offset
        : -offset
      : wing === 'toward'
        ? -offset
        : offset;
  const level = round(preferred + signed);
  if (side === 'buy' && wing === 'away') {
    return level > 0 && level < preferred ? level : undefined;
  }
  if (side === 'buy' && wing === 'toward') {
    return level > preferred && level < price ? level : undefined;
  }
  if (wing === 'away') {
    return level > preferred ? level : undefined;
  }
  return level < preferred && level > price ? level : undefined;
}

/**
 * Deterministic limit-order zones from swing S/R, with Bollinger fallback.
 * ATR is only a buffer around the preferred level.
 * The model explains these — it does not invent them.
 */
export function buildLimitZones(input: {
  price: number;
  levels: PriceLevel[];
  bollinger?: BollingerSnapshot;
  atr14?: number;
}): LimitZone[] {
  const { price, levels, bollinger, atr14 = 0 } = input;
  if (!Number.isFinite(price) || price <= 0) return [];

  const buffer = atr14 > 0 ? atr14 * ATR_BUFFER_FRACTION : 0;
  const support = levels.find((level) => level.label === 'support');
  const resistance = levels.find((level) => level.label === 'resistance');
  const zones: LimitZone[] = [];

  const buyPreferred =
    support && support.price < price
      ? support.price
      : bollinger && bollinger.lower > 0 && bollinger.lower < price
        ? bollinger.lower
        : undefined;

  if (buyPreferred !== undefined) {
    const basis =
      support && support.price < price ? 'swing_support' : 'bollinger_lower';
    zones.push({
      side: 'buy',
      preferredUsd: round(buyPreferred),
      conservativeUsd: offsetLevel(buyPreferred, buffer, price, 'buy', 'away'),
      aggressiveUsd: offsetLevel(buyPreferred, buffer, price, 'buy', 'toward'),
      basis,
      distancePct: round(distancePct(price, buyPreferred)),
    });
  }

  const sellPreferred =
    resistance && resistance.price > price
      ? resistance.price
      : bollinger && bollinger.upper > 0 && bollinger.upper > price
        ? bollinger.upper
        : undefined;

  if (sellPreferred !== undefined) {
    const basis =
      resistance && resistance.price > price
        ? 'swing_resistance'
        : 'bollinger_upper';
    zones.push({
      side: 'sell',
      preferredUsd: round(sellPreferred),
      conservativeUsd: offsetLevel(
        sellPreferred,
        buffer,
        price,
        'sell',
        'away',
      ),
      aggressiveUsd: offsetLevel(
        sellPreferred,
        buffer,
        price,
        'sell',
        'toward',
      ),
      basis,
      distancePct: round(distancePct(price, sellPreferred)),
    });
  }

  return zones;
}
