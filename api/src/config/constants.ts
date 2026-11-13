export const DRIZZLE = Symbol('DRIZZLE');

export const APP_ENV = Symbol('APP_ENV');

export const DEFAULT_VAULT_PROGRAM_ID =
  '4yBSLwXvYQhHExDuvuuEsaHfUC392SdRSiM8r6m832Mj';

/** Known pubkey used only for Alchemy health probes (System Program). */
export const ALCHEMY_HEALTH_PUBKEY = '11111111111111111111111111111111';

/** Mainnet USDC mint — counted as cash, not an equity position. */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Tokens.xyz canonical asset id for USD stables. */
export const USD_ASSET_ID = 'usd';

/** Default USDC decimals on Solana mainnet. */
export const USDC_DECIMALS = 6;

/** Default swap slippage (0.5%). */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** In-memory executable quote lifetime. */
export const QUOTE_TTL_MS = 30_000;

/** Max tokenized variants to Jupiter-quote per TradeIntent. */
export const MAX_VARIANT_QUOTES = 5;

/** Concurrency when quoting multiple variants. */
export const VARIANT_QUOTE_CONCURRENCY = 3;

/** How long quoteId → executionId mappings live after prepare. */
export const PENDING_EXECUTION_TTL_MS = 60 * 60 * 1000;

/** How long generated basket proposals stay prepare-able. */
export const BASKET_TTL_MS = 10 * 60 * 1000;

/** How long limit-order proposals stay prepare-able (same window as baskets). */
export const LIMIT_ORDER_PROPOSAL_TTL_MS = 10 * 60 * 1000;

/** Smallest practical MVP basket leg notional. */
export const MIN_BASKET_LEG_USD = 1;

/** Reuse persisted stock_signals within this window. */
export const SIGNAL_TTL_MS = 15 * 60 * 1000;

/** Daily OHLCV lookback for technical-analysis briefs. */
export const TA_DAILY_LOOKBACK_DAYS = 365;

/** Hourly OHLCV lookback for short-term TA context. */
export const TA_HOURLY_LOOKBACK_DAYS = 5;

/** Minimum daily bars before TA is treated as fully reliable. */
export const TA_MIN_DAILY_BARS = 30;

/** Daily lookback for Oren Score signal computation. */
export const SIGNAL_DAILY_LOOKBACK_DAYS = 90;

/** Refresh the persisted stock discovery catalog in the background. */
export const STOCK_CATALOG_TTL_MS = 60 * 1000;

/** Reuse cached market news within this window. */
export const NEWS_TTL_MS = 10 * 60 * 1000;

/**
 * Drip ticker opinions. Personal is 100,000 requests/month (60/min published,
 * not enforced). Opinions in the default 30-day window do not need per-turn
 * freshness, so one ticker is at most three upstream reads an hour.
 */
export const DRIP_TICKER_TTL_MS = 20 * 60 * 1000;

/**
 * Latest Drip picks feed. New calls land through the day, so this is shorter
 * than the ticker cache. Polled continuously it is about 8,600 requests/month,
 * inside the Personal allowance.
 */
export const DRIP_PICKS_TTL_MS = 5 * 60 * 1000;

/** Default opportunities ranking floor. */
export const DEFAULT_MIN_OPPORTUNITY_SCORE = 40;

/** Default opportunities page size. */
export const DEFAULT_OPPORTUNITIES_LIMIT = 20;

/** Concurrency when refreshing signals for opportunities. */
export const OPPORTUNITY_REFRESH_CONCURRENCY = 4;
