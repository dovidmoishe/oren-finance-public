import type { StockAnalysis, NewsItem } from "./stock";

export interface ResearchSource<T> {
  available: boolean;
  observedAt?: string;
  publishedAt?: string;
  fetchedAt?: string;
  assembledAt?: string;
  data?: T;
  reason?: string;
}

export interface CompanyLink {
  label: string;
  url: string;
}

export interface CompanyCitationView {
  form: string;
  filed: string;
  periodStart?: string;
  periodEnd: string;
  sourceUrl: string;
}

export interface CompanyMetricView {
  available: boolean;
  reason?: string;
  display?: string;
  value?: number;
  derived?: boolean;
  citation?: CompanyCitationView;
  inputCitations?: CompanyCitationView[];
}

export interface CompanyPeriodView {
  fiscalYear: number;
  fiscalQuarter?: number;
  start: string;
  end: string;
  derived?: boolean;
  revenue?: CompanyMetricView;
  netIncome?: CompanyMetricView;
  operatingMargin?: CompanyMetricView;
  revenueGrowth?: CompanyMetricView;
}

export interface CompanyResearchData {
  coverage: string;
  detail?: string;
  briefing: string[];
  links: CompanyLink[];
  filingCadence?: "current" | "stale";
  latestQuarter?: CompanyPeriodView;
  latestAnnual?: CompanyPeriodView;
  ttm?: {
    revenue?: CompanyMetricView;
    netIncome?: CompanyMetricView;
    operatingMargin?: CompanyMetricView;
    revenueGrowth?: CompanyMetricView;
    start?: string;
    end?: string;
  };
  filings: Array<{
    form: string;
    filed: string;
    reportDate?: string;
    acceptedAt?: string;
    accession: string;
    sourceUrl: string;
    items?: string;
  }>;
}
export interface ResearchOpinion {
  author: string;
  source: string;
  sourceLabel?: string;
  linkLabel?: string;
  date: string;
  url: string;
  stance?: "BULLISH" | "BEARISH" | "NEUTRAL";
  action?: string;
  summary: string;
}
export interface OpinionOverlay {
  items: ResearchOpinion[];
  window?: { from?: string; to?: string };
  mentionCount: number;
  distinctAuthors: number;
  stanceByAuthor: { bullish: number; bearish: number; neutral: number };
  coverage: "empty" | "thin" | "current" | "stale";
  disagreement: boolean;
  truncated: boolean;
}
export interface SavedThesis {
  id: string;
  assetId: string;
  note: string;
  snapshot: {
    capturedAt: string;
    opinionCitations: ResearchOpinion[];
    newsCitations: Array<{
      headline: string;
      url: string;
      publishedAt: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
}
export interface ResearchChange {
  kind: "score" | "opinion_added" | "opinion_changed" | "news_added";
  text: string;
  url?: string;
}
export interface StockResearch {
  assetId: string;
  ticker: string;
  name: string;
  generatedAt: string;
  analysis: ResearchSource<StockAnalysis>;
  news: ResearchSource<NewsItem[]>;
  portfolio: ResearchSource<{
    quantity: number;
    valueUsd: number;
    allocationPercent: number;
    availableAmount: number;
    lockedAmount: number;
  } | null>;
  opinions: ResearchSource<OpinionOverlay>;
  company?: ResearchSource<CompanyResearchData>;
  saved?: SavedThesis;
  changes?: ResearchChange[];
}
