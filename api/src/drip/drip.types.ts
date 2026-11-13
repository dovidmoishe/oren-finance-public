export const DRIP_OPINION_FETCH_LIMIT = 200;
export const DRIP_OPINION_RETURN_DEFAULT = 8;
export const DRIP_OPINION_RETURN_MAX = 40;
/** Research overlay reads the deduped window, not the chat highlight list. */
export const DRIP_OPINION_RESEARCH_LIMIT = 40;
export const DRIP_PICKS_FETCH_LIMIT = 15;
export const DRIP_PICKS_FETCH_DAYS = 2;
export const DRIP_PICKS_RETURN_DEFAULT = 8;
export const DRIP_PICKS_RETURN_MAX = 12;

export const DRIP_DISCLAIMER = 'Opinions, not facts, and not financial advice.';

export type DripStance = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type DripSourceKind =
  | 'x_post'
  | 'substack'
  | 'podcast'
  | 'newsletter'
  | 'video'
  | 'article'
  | 'other';

export interface DripOpinionFilter {
  stance?: DripStance;
  author?: string;
  action?: string;
}

export type DripFailureReason =
  | 'DRIP_UNSET'
  | 'DRIP_TIMEOUT'
  | 'DRIP_RATE_LIMITED'
  | 'DRIP_FORBIDDEN'
  | 'DRIP_UNAVAILABLE'
  | 'DRIP_BAD_TICKER';

export interface DripCitation {
  author: string;
  /** Publication or episode title when Drip has one. */
  source?: string;
  /** Where the take was published, from the payload — not a feed-wide guess. */
  sourceKind?: DripSourceKind;
  sourceLabel?: string;
  /** Short name for a chat link, such as "BowTied Bull" or "@TheLongInvest". */
  linkLabel?: string;
  date?: string;
  stance?: DripStance;
  action?: string;
  summary?: string;
  quote?: string;
  url?: string;
  guest?: boolean;
}

export interface DripOpinionSummary {
  calls: number;
  analysts: number;
  bullish: number;
  bearish: number;
  neutral: number;
  unstated?: number;
  byAction: Record<string, number>;
  /** sourceLabel → count, over the same deduped rows as the other counts. */
  bySource?: Record<string, number>;
}

export interface DripOpinions {
  available: true;
  source: 'drip';
  queried: string;
  ticker: string;
  mappedFrom?: string;
  window?: { from?: string; to?: string };
  asOf?: string;
  summary: DripOpinionSummary;
  /** True only when Drip said the window itself was cut off. */
  truncated: boolean;
  /** False when `truncated` is set. Counts then describe the fetched sample. */
  windowComplete?: boolean;
  /** Diverse cites chosen from the full deduped window, not only the page. */
  highlights?: DripCitation[];
  opinions: DripCitation[];
  /** Set when the caller asked for one stance, author, or action. */
  appliedFilter?: DripOpinionFilter;
  disclaimer: string;
}

export interface DripPick extends DripCitation {
  ticker: string;
}

export interface DripPicks {
  available: true;
  source: 'drip';
  window?: { from?: string; to?: string };
  asOf?: string;
  truncated: boolean;
  windowComplete?: boolean;
  picks: DripPick[];
  disclaimer: string;
}

export interface DripUnavailable {
  available: false;
  source: 'drip';
  reason: DripFailureReason;
  queried?: string;
  ticker?: string;
  message: string;
}

export type DripOpinionResult = DripOpinions | DripUnavailable;
export type DripPicksResult = DripPicks | DripUnavailable;

/** Cached opinions before the caller's symbol and limit are applied. */
export interface CachedDripOpinions {
  ticker: string;
  window?: { from?: string; to?: string };
  asOf?: string;
  summary: DripOpinionSummary;
  truncated: boolean;
  opinions: DripCitation[];
}

export interface CachedDripPicks {
  window?: { from?: string; to?: string };
  asOf?: string;
  truncated: boolean;
  picks: DripPick[];
}
