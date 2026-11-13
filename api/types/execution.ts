import type { TokenizedEquity } from './equity';
import type { Quote, TradeSide } from './quote';
import type { StockOpportunity } from './analysis';
import type { MarketSession } from './market-session';

export type ExecutionType =
  | 'stock_purchase'
  | 'stock_sale'
  | 'basket_purchase'
  | 'lock'
  | 'unlock'
  | 'limit_buy'
  | 'limit_sell'
  | 'limit_cancel';

export type ExecutionStatus =
  | 'preparing'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed';

export type ExecutionFeature =
  | 'direct'
  | 'agent'
  | 'basket'
  | 'copy_trade'
  | 'limit_order';

/** Intent in canonical-equity terms (before mint / Jupiter resolution). */
export interface TradeIntent {
  side: TradeSide;
  assetId?: string;
  ticker: string;
  amountUsd?: number;
  amount?: number;
  preferredMint?: string;
  slippageBps?: number;
  /**
   * User wallet the swap will be built for. Optional; without it only
   * wallet-agnostic venues (Jupiter) can quote.
   */
  wallet?: string;
  /**
   * True for silent client re-quotes (no user waiting on a click). These
   * use the background rate lane so they never starve user swaps.
   */
  autoRefresh?: boolean;
  /**
   * In-chat delegated signing can only sign Jupiter. When set, the router
   * skips Titan, including a later re-quote. Browser review leaves this
   * unset and keeps best-of routing.
   */
  jupiterOnly?: boolean;
}

export interface QuoteRequest {
  side: TradeSide;
  inputMint: string;
  outputMint: string;
  /** Amount in input token UI units. */
  amount: number;
  slippageBps?: number;
  wallet?: string;
  assetId?: string;
  ticker?: string;
}

export interface PreparedTransaction {
  executionId: string;
  quoteId: string;
  wallet: string;
  /** Base64-serialized transaction for wallet signing. */
  transaction: string;
  provider: string;
  expiresAt: Date;
  /**
   * Provider hard expiry in slots (Titan routes). The approval refuses to
   * sign once the cluster reaches this slot.
   */
  expiresAfterSlot?: number;
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

export interface Basket {
  id: string;
  totalAmountUsd: number;
  allocations: BasketAllocation[];
  thesis?: string;
  riskLabel?: string;
  featureSource?: Extract<ExecutionFeature, 'basket' | 'copy_trade'>;
  marketSession?: MarketSession;
  createdAt: Date;
}

export interface BasketCandidate {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  logo?: string;
  signals?: StockOpportunity['signals'];
}

export type BasketLegStatus =
  | 'waiting'
  | 'quoting'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'skipped';

export interface BasketLegProgress {
  assetId: string;
  ticker: string;
  status: BasketLegStatus;
  quote?: Quote;
  variant?: TokenizedEquity;
  preparedTransaction?: PreparedTransaction;
  error?: string;
  /** Set when the leg was refused with PRICE_MOVED (see PriceMovedDetails). */
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
  transactions: PreparedTransaction[];
  progress: BasketExecutionProgress;
}

/** Terms shown to the user when a prepare is refused (UI units + raw). */
export interface PriceMovedTerms {
  provider: string;
  outputAmount: number;
  /** Smallest output the route would enforce on-chain (UI units). */
  minimumOutputAmount: number;
  minOutRaw: string;
  slippageBps: number;
  outputSymbol: string;
}

/**
 * Body sent with a 409 PRICE_MOVED. `alternative` is a fresh Jupiter quote
 * for the same trade (no route payload). It is only an offer: the client
 * must start a new review/approval with `alternative.id`; nothing executes
 * without the user's confirmation.
 */
export interface PriceMovedDetails {
  quoteId: string;
  reviewed: PriceMovedTerms;
  /** Best route we could get now, which fell below `reviewed`. */
  latest?: PriceMovedTerms;
  /** Public quote (no routePayload) plus its own enforced minimum. */
  alternative?: Quote & {
    minimumOutputAmount: number;
    minOutRaw: string;
  };
}
