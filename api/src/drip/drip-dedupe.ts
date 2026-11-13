import type { DripCitation } from './drip.types';

/** Same author reposting essentially the same take. */
export const DRIP_NEAR_DUPLICATE_WINDOW_MS = 3 * 60 * 60 * 1000;
const NEAR_DUPLICATE_SIMILARITY = 0.8;

export function dedupeCitations<T extends DripCitation>(items: T[]): T[] {
  const sorted = [...items].sort(
    (left, right) => timeValue(right.date) - timeValue(left.date),
  );
  const kept: T[] = [];
  const urls = new Set<string>();
  for (const item of sorted) {
    const url = item.url ? urlKey(item.url) : undefined;
    if (url && urls.has(url)) continue;
    if (kept.some((existing) => isNearDuplicate(existing, item))) continue;
    if (url) urls.add(url);
    kept.push(item);
  }
  return kept;
}

/** A few varied cites for the answer, not the whole window. */
export function selectHighlights<T extends DripCitation>(
  items: T[],
  limit: number,
): T[] {
  const newest = [...items].sort(
    (left, right) => timeValue(right.date) - timeValue(left.date),
  );
  const chosen: T[] = [];
  const authors = new Set<string>();
  const take = (matches: (item: T) => boolean, max = limit) => {
    let taken = 0;
    for (const item of newest) {
      if (chosen.length >= limit || taken >= max) return;
      const author = item.author.trim().toLowerCase();
      if (authors.has(author) || !matches(item)) continue;
      authors.add(author);
      chosen.push(item);
      taken += 1;
    }
  };
  // One per stance first, so a run of bullish posts cannot hide bearish ones.
  take((item) => item.stance === 'BULLISH', 1);
  take((item) => item.stance === 'BEARISH', 1);
  take((item) => item.stance === 'NEUTRAL' || !item.stance, 1);
  take(() => true);
  return chosen.sort(
    (left, right) => timeValue(right.date) - timeValue(left.date),
  );
}

function isNearDuplicate(
  existing: DripCitation,
  candidate: DripCitation,
): boolean {
  if (
    existing.author.trim().toLowerCase() !==
    candidate.author.trim().toLowerCase()
  ) {
    return false;
  }
  const left = citationBody(existing);
  const right = citationBody(candidate);
  if (left && left === right) return true;
  const leftAt = timeValue(existing.date);
  const rightAt = timeValue(candidate.date);
  if (
    !leftAt ||
    !rightAt ||
    Math.abs(leftAt - rightAt) > DRIP_NEAR_DUPLICATE_WINDOW_MS
  ) {
    return false;
  }
  const leftTitle = normalizeText(existing.source ?? '');
  const rightTitle = normalizeText(candidate.source ?? '');
  if (leftTitle && leftTitle === rightTitle && leftTitle.length > 12)
    return true;
  return similarity(left, right) >= NEAR_DUPLICATE_SIMILARITY;
}

function citationBody(item: DripCitation): string {
  return normalizeText(
    [item.summary, item.quote, item.source].filter(Boolean).join(' '),
  );
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const status = parsed.pathname.match(/\/status\/(\d+)/);
    if (
      (host === 'x.com' ||
        host === 'twitter.com' ||
        host === 'mobile.twitter.com') &&
      status
    ) {
      return `x-status:${status[1]}`;
    }
    return `${host}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.75) {
    return shorter.length / longer.length;
  }
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const union = leftTokens.size + rightTokens.size - shared;
  return union ? shared / union : 0;
}

function tokens(value: string): Set<string> {
  return new Set(value.split(' ').filter((word) => word.length > 2));
}

function timeValue(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}
