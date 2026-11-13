import type { MarketCandle } from '../../../types/market';

function weekKey(timestamp: Date): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

/**
 * Aggregate daily candles into weekly OHLCV bars (UTC week starting Monday).
 */
export function resampleWeekly(bars: MarketCandle[]): MarketCandle[] {
  const sorted = [...bars].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const buckets = new Map<string, MarketCandle>();

  for (const bar of sorted) {
    const key = weekKey(bar.timestamp);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { ...bar });
      continue;
    }

    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume = (existing.volume ?? 0) + (bar.volume ?? 0);
  }

  return [...buckets.values()].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
}
