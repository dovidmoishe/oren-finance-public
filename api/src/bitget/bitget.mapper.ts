import type {
  BitgetMarketQuote,
  BitgetMarketSession,
} from '../../types/bitget';
import type { MarketCandle } from '../../types/market';
import type {
  BitgetCandleRaw,
  BitgetMarketStateRaw,
  BitgetTickerRaw,
} from './bitget.types';

export function mapBitgetQuote(
  raw: BitgetTickerRaw,
): BitgetMarketQuote | undefined {
  const lastPriceUsd = finiteNumber(raw.lastPrice);
  if (lastPriceUsd === undefined) return undefined;

  const bidUsd = finiteNumber(raw.bid1Price);
  const askUsd = finiteNumber(raw.ask1Price);
  const midpoint =
    bidUsd !== undefined && askUsd !== undefined
      ? (bidUsd + askUsd) / 2
      : undefined;

  return compact({
    lastPriceUsd,
    open24hUsd: finiteNumber(raw.openPrice24h),
    high24hUsd: finiteNumber(raw.highPrice24h),
    low24hUsd: finiteNumber(raw.lowPrice24h),
    change24hPct: percentFromFraction(raw.price24hPcnt),
    volume24h: finiteNumber(raw.volume24h),
    turnover24hUsd: finiteNumber(raw.turnover24h),
    platformTurnover24hUsd: finiteNumber(raw.platformTurnover24h),
    bidUsd,
    askUsd,
    spreadBps:
      midpoint && midpoint > 0 && bidUsd !== undefined && askUsd !== undefined
        ? round(((askUsd - bidUsd) / midpoint) * 10_000, 2)
        : undefined,
  });
}

export function mapBitgetCandles(rows: BitgetCandleRaw[]): MarketCandle[] {
  return rows
    .map((row): MarketCandle | undefined => {
      const timestamp = finiteNumber(row[0]);
      const open = finiteNumber(row[1]);
      const high = finiteNumber(row[2]);
      const low = finiteNumber(row[3]);
      const close = finiteNumber(row[4]);
      const volume = finiteNumber(row[5]);
      if (
        timestamp === undefined ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined
      ) {
        return undefined;
      }
      return compact({
        timestamp: new Date(timestamp),
        open,
        high,
        low,
        close,
        volume,
      });
    })
    .filter((item): item is MarketCandle => item !== undefined)
    .sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
}

export function mapBitgetSessions(states: BitgetMarketStateRaw[]): {
  daylightType?: string;
  sessions: BitgetMarketSession[];
} {
  const us =
    states.find((item) => item.market?.toUpperCase() === 'US') ?? states[0];
  const sessions = (us?.stateList ?? [])
    .map((item): BitgetMarketSession | undefined => {
      if (!item.state || !item.startTime || !item.endTime) return undefined;
      return {
        state: item.state,
        timeZone: item.timeZone ?? 'ET',
        startTime: item.startTime,
        endTime: item.endTime,
      };
    })
    .filter((item): item is BitgetMarketSession => item !== undefined);
  return compact({ daylightType: us?.daylightType, sessions });
}

function percentFromFraction(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number === undefined ? undefined : round(number * 100, 4);
}

function finiteNumber(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
