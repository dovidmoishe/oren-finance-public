import type {
  MarketSession,
  UsMarketSessionState,
} from '../../types/market-session';
import type { Quote } from '../../types/quote';

/**
 * NYSE cash-session clock in America/New_York.
 *
 * Full closes and 1:00 p.m. ET early closes are the dates NYSE Group
 * published for 2026 and 2027 (announcement, 23 Dec 2025). Early-close
 * days stay in the regular session until 13:00 ET. Weekends and full
 * holidays are closed for the whole local calendar day.
 *
 * https://www.nyse.com/trade/hours-calendars
 */
export const NYSE_CALENDAR_COVERED_THROUGH = '2027-12-31';

export const NYSE_FULL_CLOSE_DATES = [
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
] as const;

/** 1:00 p.m. ET early closes. July 2 2026 and July 2 2027 are full sessions. */
export const NYSE_EARLY_CLOSE_DATES = [
  '2026-11-27',
  '2026-12-24',
  '2027-11-26',
] as const;

export const THIN_BOOK_IMPACT_PERCENT = 1;
export const THIN_BOOK_LIQUIDITY_USD = 100_000;

const PRE_MARKET_SUMMARY =
  "US markets aren't in the regular session yet. This price is the on-chain market, and it can differ from the next open.";
const AFTER_HOURS_SUMMARY =
  'The regular US session is over. On-chain prices can drift until the next open.';
const OVERNIGHT_SUMMARY =
  'US markets are closed for the night. The on-chain book is often thinner, and the price can sit away from the stock until the open.';
const CLOSED_SUMMARY =
  'US markets are closed. On-chain liquidity is often thinner, and the price can sit away from the stock until the next open.';
const REGULAR_SUMMARY = 'US markets are in the regular session.';
const LIMIT_SUMMARY =
  "US markets aren't in the regular session. This limit uses the on-chain price, which may not match the next open. It fills only if the market reaches your price.";
const THIN_BOOK_SENTENCE =
  'This size also moves the on-chain price more than a typical fill. A smaller amount usually lands closer.';

const FULL_CLOSES = new Set<string>(NYSE_FULL_CLOSE_DATES);
const EARLY_CLOSES = new Set<string>(NYSE_EARLY_CLOSE_DATES);

const OPEN_MINUTE = 9 * 60 + 30;
const FULL_CLOSE_MINUTE = 16 * 60;
const EARLY_CLOSE_MINUTE = 13 * 60;
const PRE_MARKET_MINUTE = 4 * 60;
const AFTER_HOURS_END_MINUTE = 20 * 60;

export interface MarketSessionInput {
  at?: Date;
  kind?: 'market' | 'limit';
  priceImpactPercent?: number;
  liquidityUsd?: number;
}

export function usMarketSession(at: Date = new Date()): MarketSession {
  return marketSessionForTrade({ at, kind: 'market' });
}

export function marketSessionForTrade(
  input: MarketSessionInput = {},
): MarketSession {
  const at = input.at ?? new Date();
  const state = classify(at);
  const regular = state === 'regular';
  const kind = input.kind ?? 'market';
  const impact = input.priceImpactPercent ?? 0;
  const illiquid =
    input.liquidityUsd !== undefined &&
    input.liquidityUsd < THIN_BOOK_LIQUIDITY_USD;
  const thinBook = !regular && (impact >= THIN_BOOK_IMPACT_PERCENT || illiquid);
  const base = summaryFor(state, kind);
  const summary =
    kind === 'market' && thinBook ? `${base} ${THIN_BOOK_SENTENCE}` : base;
  return {
    state,
    regular,
    summary,
    observedAt: at.toISOString(),
    thinBook,
  };
}

/** Attach a session to a catalog stock quote. Non-equity mints are left alone. */
export function stampQuoteMarketSession(quote: Quote, at = new Date()): Quote {
  if (!quote.assetId || quote.assetId === 'unknown') return quote;
  quote.marketSession = marketSessionForTrade({
    at,
    kind: 'market',
    priceImpactPercent: quote.priceImpactPercent,
    liquidityUsd: quote.variant?.liquidity,
  });
  return quote;
}

function summaryFor(
  state: UsMarketSessionState,
  kind: 'market' | 'limit',
): string {
  if (state === 'regular') return REGULAR_SUMMARY;
  if (kind === 'limit') return LIMIT_SUMMARY;
  switch (state) {
    case 'pre_market':
      return PRE_MARKET_SUMMARY;
    case 'after_hours':
    case 'early_close':
      return AFTER_HOURS_SUMMARY;
    case 'overnight':
      return OVERNIGHT_SUMMARY;
    case 'closed':
      return CLOSED_SUMMARY;
  }
}

function classify(at: Date): UsMarketSessionState {
  const { ymd, minutes, weekday } = nyParts(at);
  if (weekday === 'Sat' || weekday === 'Sun' || FULL_CLOSES.has(ymd)) {
    return 'closed';
  }
  const early = EARLY_CLOSES.has(ymd);
  const regularEnd = early ? EARLY_CLOSE_MINUTE : FULL_CLOSE_MINUTE;
  if (minutes >= OPEN_MINUTE && minutes < regularEnd) return 'regular';
  if (minutes >= PRE_MARKET_MINUTE && minutes < OPEN_MINUTE)
    return 'pre_market';
  if (minutes >= regularEnd && minutes < AFTER_HOURS_END_MINUTE) {
    return early ? 'early_close' : 'after_hours';
  }
  return 'overnight';
}

function nyParts(at: Date): { ymd: string; minutes: number; weekday: string } {
  const bag: Record<string, string> = {};
  for (const part of nyFormatter.formatToParts(at)) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
    minutes: hour * 60 + Number(bag.minute),
    weekday: bag.weekday ?? '',
  };
}

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});
