/**
 * Equity / market news from Tokens API (and optional cached_news).
 */
export interface MarketNewsItem {
  id?: string;
  assetId?: string;
  ticker?: string;
  headline: string;
  source?: string;
  summary?: string;
  url?: string;
  publishedAt: Date;
  imageUrl?: string;
}

export interface EquityRisk {
  assetId: string;
  ticker: string;
  /** Provider-defined risk metrics — keep flexible for Tokens API shape. */
  score?: number;
  label?: string;
  volatility?: number;
  metadata?: Record<string, unknown>;
}

export interface NewsFeed {
  assetId?: string;
  items: MarketNewsItem[];
}

export interface NewsContext {
  assetIds: string[];
  items: MarketNewsItem[];
  generatedAt: Date;
}
