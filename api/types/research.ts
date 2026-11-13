import type { StockAnalysis } from './analysis';
import type { CompanyResearchData } from './company-research';
import type { MarketNewsItem } from './news';
import type { Position } from './position';

export interface ResearchSource<T> {
  available: boolean;
  /** Source time kept for existing desks. Company filings also set the three clocks below. */
  observedAt?: string;
  /** When the filer or publisher dated the evidence. */
  publishedAt?: string;
  /** When Oren retrieved the source payload. */
  fetchedAt?: string;
  /** When this report assembled the source. */
  assembledAt?: string;
  data?: T;
  reason?: string;
}

export interface ResearchOpinion {
  author: string;
  source: string;
  sourceLabel?: string;
  linkLabel?: string;
  date: string;
  url: string;
  stance?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  action?: string;
  summary: string;
}

export interface OpinionOverlay {
  items: ResearchOpinion[];
  asOf?: string;
  window?: { from?: string; to?: string };
  mentionCount: number;
  distinctAuthors: number;
  stanceByAuthor: { bullish: number; bearish: number; neutral: number };
  coverage: 'empty' | 'thin' | 'current' | 'stale';
  disagreement: boolean;
  truncated: boolean;
}

export interface StockResearch {
  assetId: string;
  ticker: string;
  name: string;
  generatedAt: string;
  analysis: ResearchSource<StockAnalysis>;
  news: ResearchSource<MarketNewsItem[]>;
  portfolio: ResearchSource<Pick<
    Position,
    | 'quantity'
    | 'valueUsd'
    | 'allocationPercent'
    | 'availableAmount'
    | 'lockedAmount'
  > | null>;
  opinions: ResearchSource<OpinionOverlay>;
  /** SEC company facts. Omitted only by older stored fixtures. */
  company?: ResearchSource<CompanyResearchData>;
  saved?: SavedThesis;
  changes?: ResearchChange[];
}

export interface ResearchSnapshot {
  score?: number;
  analysisObservedAt?: string;
  opinionKeys: string[];
  opinionStances: Record<string, string>;
  opinionCitations: ResearchOpinion[];
  newsUrls: string[];
  newsCitations: Array<{ headline: string; url: string; publishedAt: string }>;
  capturedAt: string;
}

export interface SavedThesis {
  id: string;
  assetId: string;
  note: string;
  snapshot: ResearchSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchChange {
  kind: 'score' | 'opinion_added' | 'opinion_changed' | 'news_added';
  text: string;
  url?: string;
}
