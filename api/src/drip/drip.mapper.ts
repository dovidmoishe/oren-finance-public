import { dedupeCitations, selectHighlights } from './drip-dedupe';
import { classifyDripSource, dripLinkLabel, sourceLabel } from './drip-source';
import {
  DRIP_DISCLAIMER,
  type CachedDripOpinions,
  type CachedDripPicks,
  type DripCitation,
  type DripOpinionSummary,
  type DripOpinionFilter,
  type DripOpinions,
  type DripPick,
  type DripPicks,
  type DripSourceKind,
  type DripStance,
} from './drip.types';

const QUOTE_LIMIT = 180;
const SUMMARY_LIMIT = 220;
const LABEL_LIMIT = 80;

export function compactTickerCoverage(
  body: unknown,
): CachedDripOpinions | null {
  if (!isRecord(body) || !Array.isArray(body.authors)) return null;
  const meta = isRecord(body.meta) ? body.meta : {};
  const ticker = text(meta.ticker)?.toUpperCase();
  if (!ticker) return null;

  const opinions = dedupeCitations(flattenMentions(body.authors));
  const upstreamTruncated = meta.truncated === true;
  return {
    ticker,
    window: windowFrom(meta.from, meta.to),
    asOf: text(meta.asOf),
    summary: summarizeCitations(opinions),
    truncated: upstreamTruncated,
    opinions,
  };
}

export function compactPicks(body: unknown): CachedDripPicks | null {
  if (!isRecord(body) || !Array.isArray(body.picks)) return null;
  const meta = isRecord(body.meta) ? body.meta : {};
  const applied = isRecord(meta.appliedRange) ? meta.appliedRange : {};
  const pagination = isRecord(body.pagination) ? body.pagination : {};
  const picks = dedupeCitations(
    body.picks
      .map(compactPick)
      .filter((pick): pick is DripPick => pick !== null),
  );
  return {
    window: windowFrom(applied.from, applied.to),
    asOf: text(meta.asOf),
    truncated: meta.truncated === true || pagination.nextCursor != null,
    picks,
  };
}

export function presentOpinions(
  cached: CachedDripOpinions,
  queried: string,
  mappedFrom: string | undefined,
  limit: number,
  filter?: DripOpinionFilter,
): DripOpinions {
  const applied = normalizeFilter(filter);
  const matched = applied
    ? filterCitations(cached.opinions, applied)
    : cached.opinions;
  const opinions = matched.slice(0, limit);
  return defined({
    available: true as const,
    source: 'drip' as const,
    queried,
    ticker: cached.ticker,
    mappedFrom,
    window: cached.window,
    asOf: cached.asOf,
    summary: applied ? summarizeCitations(matched) : cached.summary,
    truncated: cached.truncated,
    windowComplete: !cached.truncated,
    highlights: selectHighlights(matched, 4),
    opinions,
    appliedFilter: applied,
    disclaimer: DRIP_DISCLAIMER,
  });
}

export function filterCitations<T extends DripCitation>(
  items: T[],
  filter: DripOpinionFilter,
): T[] {
  const author = filter.author?.trim().toLowerCase();
  const action = filter.action?.trim().toUpperCase();
  return items.filter((item) => {
    if (filter.stance && item.stance !== filter.stance) return false;
    if (author && !item.author.toLowerCase().includes(author)) return false;
    if (action && (item.action?.trim().toUpperCase() ?? '') !== action) {
      return false;
    }
    return true;
  });
}

function normalizeFilter(
  filter: DripOpinionFilter | undefined,
): DripOpinionFilter | undefined {
  if (!filter) return undefined;
  const author = filter.author?.trim();
  const action = filter.action?.trim();
  const next: DripOpinionFilter = {};
  if (filter.stance) next.stance = filter.stance;
  if (author) next.author = author;
  if (action) next.action = action;
  return next.stance || next.author || next.action ? next : undefined;
}

export function presentPicks(
  cached: CachedDripPicks,
  limit: number,
): DripPicks {
  const picks = cached.picks.slice(0, limit);
  return defined({
    available: true as const,
    source: 'drip' as const,
    window: cached.window,
    asOf: cached.asOf,
    truncated: cached.truncated,
    windowComplete: !cached.truncated,
    picks,
    disclaimer: DRIP_DISCLAIMER,
  });
}

export function emptyOpinions(ticker: string): CachedDripOpinions {
  return {
    ticker,
    summary: {
      calls: 0,
      analysts: 0,
      bullish: 0,
      bearish: 0,
      neutral: 0,
      byAction: {},
    },
    truncated: false,
    opinions: [],
  };
}

function flattenMentions(authors: unknown[]): DripCitation[] {
  const citations: DripCitation[] = [];
  for (const group of authors) {
    if (!isRecord(group) || !Array.isArray(group.mentions)) continue;
    const author = clip(group.author, LABEL_LIMIT);
    if (!author) continue;
    const groupPlatform = firstText(
      group.platform,
      group.sourcePlatform,
      group.publicationPlatform,
    );
    const groupSlug = firstText(group.publicationSlug, group.sourceSlug);
    for (const mention of group.mentions) {
      const citation = compactMention(author, mention, {
        platform: groupPlatform,
        slug: groupSlug,
      });
      if (citation) citations.push(citation);
    }
  }
  return citations.filter(
    (item) =>
      Boolean(item.url) &&
      Boolean(item.date) &&
      Number.isFinite(Date.parse(item.date ?? '')),
  );
}

function compactMention(
  author: string,
  mention: unknown,
  group: { platform?: string; slug?: string },
): DripCitation | null {
  if (!isRecord(mention)) return null;
  const summary =
    clip(mention.thesis, SUMMARY_LIMIT) ??
    clip(mention.rationaleSnippet, SUMMARY_LIMIT);
  const quote = clip(mention.evidenceQuote, QUOTE_LIMIT);
  if (!summary && !quote) return null;
  const url = safeUrl(mention.articleUrl);
  const guest = mention.speakerIsGuest === true;
  const kind = classifyDripSource({
    platform:
      firstText(
        mention.platform,
        mention.sourcePlatform,
        mention.publicationPlatform,
      ) ?? group.platform,
    url,
    slug: firstText(mention.publicationSlug, mention.sourceSlug) ?? group.slug,
    guest,
  });
  return withSource(
    defined({
      author,
      source: clip(mention.articleTitle, LABEL_LIMIT),
      date: text(mention.publishedAt),
      stance: stanceOf(mention.sentiment),
      action: text(mention.action),
      summary,
      quote,
      url,
      guest: guest ? true : undefined,
    }),
    kind,
  );
}

function compactPick(pick: unknown): DripPick | null {
  if (!isRecord(pick)) return null;
  const ticker = text(pick.ticker)?.toUpperCase();
  const author = clip(pick.author, LABEL_LIMIT);
  if (!ticker || !author) return null;
  const url = safeUrl(pick.articleUrl);
  const date = text(pick.publishedAt) ?? text(pick.date);
  if (!url || !date || !Number.isFinite(Date.parse(date))) return null;
  const summary =
    clip(pick.thesis, SUMMARY_LIMIT) ??
    clip(pick.rationaleSnippet, SUMMARY_LIMIT);
  const quote = clip(pick.evidenceQuote, QUOTE_LIMIT);
  if (!summary && !quote) return null;
  const guest = pick.speakerIsGuest === true;
  const kind = classifyDripSource({
    platform: firstText(
      pick.platform,
      pick.sourcePlatform,
      pick.publicationPlatform,
    ),
    url,
    slug: text(pick.publicationSlug),
    guest,
  });
  return withSource(
    defined({
      ticker,
      author,
      source:
        clip(pick.publicationTitle, LABEL_LIMIT) ??
        clip(pick.publicationSlug, LABEL_LIMIT),
      date,
      stance: stanceOf(pick.sentiment),
      action: text(pick.action),
      summary,
      quote,
      url,
      guest: guest ? true : undefined,
    }),
    kind,
  );
}

function withSource<T extends DripCitation>(
  citation: T,
  kind: DripSourceKind,
): T {
  return {
    ...citation,
    sourceKind: kind,
    sourceLabel: sourceLabel(kind),
    linkLabel: dripLinkLabel(citation.author, citation.url),
  };
}

function summarizeCitations(opinions: DripCitation[]): DripOpinionSummary {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let unstated = 0;
  const byAction: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const authors = new Set<string>();
  for (const item of opinions) {
    authors.add(item.author.trim().toLowerCase());
    if (item.stance === 'BULLISH') bullish += 1;
    else if (item.stance === 'BEARISH') bearish += 1;
    else if (item.stance === 'NEUTRAL') neutral += 1;
    else unstated += 1;
    const action = item.action?.trim() || 'UNSTATED';
    byAction[action] = (byAction[action] ?? 0) + 1;
    const label = item.sourceLabel ?? 'Post';
    bySource[label] = (bySource[label] ?? 0) + 1;
  }
  if (!byAction.UNSTATED) delete byAction.UNSTATED;
  return defined({
    calls: opinions.length,
    analysts: authors.size,
    bullish,
    bearish,
    neutral,
    unstated: unstated > 0 ? unstated : undefined,
    byAction,
    bySource,
  });
}

function windowFrom(
  from: unknown,
  to: unknown,
): { from?: string; to?: string } | undefined {
  const start = text(from);
  const end = text(to);
  if (!start && !end) return undefined;
  return { from: start, to: end };
}

function stanceOf(value: unknown): DripStance | undefined {
  if (value === 'BULLISH' || value === 'BEARISH' || value === 'NEUTRAL')
    return value;
  return undefined;
}

function safeUrl(value: unknown): string | undefined {
  const url = text(value);
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return undefined;
}

function clip(value: unknown, max: number): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1).trimEnd()}…`;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = text(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function defined<T extends object>(value: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) next[key] = item;
  }
  return next as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
