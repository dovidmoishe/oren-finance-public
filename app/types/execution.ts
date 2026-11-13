import type { MarketSession } from "./market-session";

export type TradeSide = "buy" | "sell";

export interface TradeIntent {
  wallet?: string;
  assetId?: string;
  ticker: string;
  side: TradeSide;
  amountUsd?: number;
  amount?: number;
  preferredMint?: string;
  slippageBps?: number;
  /** Silent re-quote (no user click); uses the API's background rate lane. */
  autoRefresh?: boolean;
}

export interface QuoteVariant {
  mint: string;
  symbol: string;
  name: string;
  issuer?: string;
  decimals?: number;
  liquidity?: number;
  liquidityTier?: string;
  trustTier?: string;
  tradable: boolean;
}

export interface QuoteResponse {
  id: string;
  assetId: string;
  ticker: string;
  side: TradeSide;
  variant: QuoteVariant;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inputAmount: number;
  outputAmount: number;
  estimatedPriceUsd: number;
  amountUsd: number;
  priceImpactPercent: number;
  networkFeeUsd?: number;
  slippageBps: number;
  provider: string;
  routePayload?: unknown;
  marketSession?: MarketSession;
  expiresAt: string;
  quotedAt: string;
}

export interface PrepareExecutionRequest {
  quoteId: string;
  wallet: string;
}

export interface ExecutionPreparedTransaction {
  executionId: string;
  quoteId: string;
  wallet: string;
  transaction: string;
  provider: string;
  expiresAt: string;
}

export interface ConfirmExecutionRequest {
  executionId: string;
  wallet: string;
  quoteId: string;
  signature: string;
}

export interface ExecutionStatus {
  executionId: string;
  quoteId: string;
  wallet: string;
  signature: string;
  status: "submitted";
  trackingStatus: "pending";
}

export interface BasketIntent {
  wallet?: string;
  prompt?: string;
  amountUsd: number;
  candidates?: Array<{
    assetId: string;
    ticker: string;
    name?: string;
    opportunityScore: number;
  }>;
}

export interface BasketResponse {
  id: string;
  totalAmountUsd: number;
  allocations: BasketAllocation[];
  thesis?: string;
  riskLabel?: string;
  marketSession?: MarketSession;
  createdAt: string;
}

export interface BasketAllocation {
  assetId: string;
  ticker: string;
  name?: string;
  amountUsd: number;
  weightPercent: number;
  opportunityScore?: number;
  rationale?: string;
}

export type BasketLegStatus =
  | "waiting"
  | "quoting"
  | "awaiting_signature"
  | "submitted"
  | "confirmed"
  | "failed"
  | "skipped";

export interface BasketLegProgress {
  assetId: string;
  ticker: string;
  status: BasketLegStatus;
  quote?: QuoteResponse;
  variant?: QuoteVariant;
  preparedTransaction?: ExecutionPreparedTransaction;
  error?: string;
  /** Set when the API refused the leg with PRICE_MOVED. */
  priceMoved?: PriceMovedDetails;
}

export interface BasketExecutionProgress {
  basketId: string;
  wallet?: string;
  legs: BasketLegProgress[];
}

export interface PreparedBasketPurchase {
  basketId: string;
  wallet: string;
  transactions: ExecutionPreparedTransaction[];
  progress: BasketExecutionProgress;
}

export type PreparedTransaction = ExecutionPreparedTransaction;

/** Swap terms shown when the API refuses a prepare with PRICE_MOVED. */
export interface PriceMovedTerms {
  provider: string;
  outputAmount: number;
  /** Smallest output the route enforces on-chain. */
  minimumOutputAmount: number;
  minOutRaw: string;
  slippageBps: number;
  outputSymbol: string;
}

/**
 * 409 PRICE_MOVED body (`priceMoved`). `alternative` is a fresh Jupiter quote
 * the user may review; it is never executed without a new approval.
 */
export interface PriceMovedDetails {
  quoteId: string;
  reviewed: PriceMovedTerms;
  latest?: PriceMovedTerms;
  alternative?: QuoteResponse & {
    minimumOutputAmount: number;
    minOutRaw: string;
  };
}

