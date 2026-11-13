/** Canonical asset category from Tokens API. */
export type EquityCategory = 'equity' | 'etf' | 'index';

/**
 * Canonical underlying equity.
 * Users think in stocks (AAPL); Oren maps to tokenized variants underneath.
 * Source of truth for registry / market metadata: Tokens API (not Postgres).
 */
export interface Equity {
  id: string;
  ticker: string;
  name: string;
  category: EquityCategory;
  logo?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  liquidity?: number;
  sector?: string;
  variants: TokenizedEquity[];
}

/**
 * Solana tokenized representation of a canonical equity.
 * Fields follow useful Tokens API variant data.
 */
export interface TokenizedEquity {
  mint: string;
  symbol: string;
  name: string;
  issuer?: string;
  decimals?: number;
  /**
   * Token-2022 scaled-UI multiplier in effect now (xStocks): shares shown =
   * raw / 10^decimals * uiMultiplier. Read from the mint; 1 when unscaled.
   */
  uiMultiplier?: number;
  liquidity?: number;
  liquidityTier?: string;
  trustTier?: string;
  stockVariantTier?: string;
  tradable: boolean;
}

/** Lightweight equity row for markets / search. */
export interface EquitySummary {
  id: string;
  ticker: string;
  name: string;
  category: EquityCategory;
  logo?: string;
  price?: number;
  priceChange24h?: number;
  volume24h?: number;
  liquidity?: number;
  opportunityScore?: number;
}
