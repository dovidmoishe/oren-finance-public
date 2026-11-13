import type { PriceLevel } from '../../../types/analysis';
import type { MarketCandle } from '../../../types/market';

const PIVOT_RADIUS = 2;

function isPivotHigh(bars: MarketCandle[], index: number): boolean {
  const pivot = bars[index];
  for (let offset = 1; offset <= PIVOT_RADIUS; offset++) {
    if (
      bars[index - offset]?.high >= pivot.high ||
      bars[index + offset]?.high > pivot.high
    ) {
      return false;
    }
  }
  return true;
}

function isPivotLow(bars: MarketCandle[], index: number): boolean {
  const pivot = bars[index];
  for (let offset = 1; offset <= PIVOT_RADIUS; offset++) {
    if (
      bars[index - offset]?.low <= pivot.low ||
      bars[index + offset]?.low < pivot.low
    ) {
      return false;
    }
  }
  return true;
}

function distancePct(price: number, level: number): number {
  if (!price || !level) return 0;
  return ((level - price) / price) * 100;
}

/**
 * Nearest confirmed swing support below price and resistance above price.
 */
export function swingLevels(
  bars: MarketCandle[],
  price: number,
): PriceLevel[] {
  if (bars.length < PIVOT_RADIUS * 2 + 1 || !Number.isFinite(price) || price <= 0) {
    return [];
  }

  const supports: number[] = [];
  const resistances: number[] = [];

  for (let index = PIVOT_RADIUS; index < bars.length - PIVOT_RADIUS; index++) {
    if (isPivotLow(bars, index)) {
      supports.push(bars[index].low);
    }
    if (isPivotHigh(bars, index)) {
      resistances.push(bars[index].high);
    }
  }

  const nearestSupport = supports
    .filter((level) => level < price)
    .sort((left, right) => right - left)[0];
  const nearestResistance = resistances
    .filter((level) => level > price)
    .sort((left, right) => left - right)[0];

  const levels: PriceLevel[] = [];
  if (nearestSupport !== undefined) {
    levels.push({
      price: round(nearestSupport),
      label: 'support',
      distancePct: round(distancePct(price, nearestSupport)),
    });
  }
  if (nearestResistance !== undefined) {
    levels.push({
      price: round(nearestResistance),
      label: 'resistance',
      distancePct: round(distancePct(price, nearestResistance)),
    });
  }

  return levels;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
