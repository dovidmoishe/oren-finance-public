import type { Quote } from '../../../types/quote';

/**
 * Titan Developers Portal (Gateway REST) shapes — JSON encoding.
 * Ref: https://titan-exchange.gitbook.io/titan/developer-doc/developers-portal/reference/quote-swap
 *
 * u64 values arrive as JSON numbers; they are kept as `number | string` and
 * normalised to decimal strings by the mapper before any arithmetic.
 */

export type TitanU64 = number | string;

export interface TitanAccountMeta {
  /** Address (base58). */
  p: string;
  /** Is signer. */
  s: boolean;
  /** Is writable. */
  w: boolean;
}

export interface TitanInstruction {
  /** Program id (base58). */
  p: string;
  a: TitanAccountMeta[];
  /** Instruction data, base64 in JSON. */
  d: string;
}

export interface TitanStep {
  ammKey?: string;
  label?: string;
  inputMint?: string;
  outputMint?: string;
  inAmount?: TitanU64;
  outAmount?: TitanU64;
  allocPpb?: number;
  feeMint?: string;
  feeAmount?: TitanU64;
  contextSlot?: TitanU64;
}

export interface TitanRoute {
  inAmount: TitanU64;
  outAmount: TitanU64;
  slippageBps: number;
  steps?: TitanStep[];
  instructions: TitanInstruction[];
  addressLookupTables?: string[];
  contextSlot?: TitanU64;
  computeUnits?: TitanU64;
  computeUnitsSafe?: TitanU64;
  expiresAtMs?: TitanU64;
  expiresAfterSlot?: TitanU64;
  referenceId?: string;
  timeTakenNs?: TitanU64;
}

export interface TitanAltContents {
  /** Lookup table address. */
  p: string;
  /** Addresses stored in the table, in order. */
  a: string[];
}

export interface TitanQuoteMetadata {
  ExpectedWinner?: string;
  expectedWinner?: string;
  inputMintDecimals?: number;
  outputMintDecimals?: number;
  inputPriceUSD?: number;
  outputPriceUSD?: number;
  errors?: Record<string, string>;
  [key: string]: unknown;
}

export interface TitanQuoteResponse {
  id: string;
  inputMint: string;
  outputMint: string;
  amount: TitanU64;
  quotes: Record<string, TitanRoute>;
  metadata?: TitanQuoteMetadata;
  alts?: TitanAltContents[];
}

export interface TitanQuoteParams {
  inputMint: string;
  outputMint: string;
  /** Smallest-unit input amount (decimal string). */
  amount: string;
  userPublicKey: string;
  /** Always passed explicitly — Titan defaults to 100, Oren uses 50. */
  slippageBps: number;
  numQuotes?: number;
  /** Overrides TITAN_MAX_PRICE_DEVIATION_BPS for one request. */
  maxPriceDeviationBps?: number;
  /** Ask Titan to inline ALT contents (default false; we load from chain). */
  includeAltContents?: boolean;
}

/**
 * Stable codes used for typed errors, fallbacks and comparison logs.
 * `skipped_*` / `breaker_open` / `disabled` / `no_wallet` never hit the network.
 */
export type TitanErrorCode =
  | 'disabled'
  | 'no_wallet'
  | 'skipped_rate_budget'
  | 'breaker_open'
  | 'invalid_api_key'
  | 'no_route'
  | 'rate_limited'
  | 'allowance_exhausted'
  | 'bad_request'
  | 'forbidden'
  | 'timeout'
  | 'network'
  | 'upstream_error'
  | 'invalid_response'
  | 'stale_quote'
  | 'wallet_mismatch'
  | 'disallowed_instruction'
  | 'tx_build_failed';

/** Everything needed later to build the Titan transaction server-side. */
export interface TitanRoutePayload {
  kind: 'titan';
  /** Titan quote request id (for support/debugging). */
  quoteId: string;
  providerId: string;
  route: TitanRoute;
  /**
   * Inline lookup-table contents, if Titan sent them. Informational only:
   * the tx builder always loads tables from chain.
   */
  alts: TitanAltContents[];
  /** Wallet the instructions were built for — signing with another fails. */
  wallet: string;
  /** Epoch ms when Titan answered. */
  quotedAtMs: number;
  /** Raw smallest-unit amounts for exact comparisons. */
  inAmountRaw: string;
  outAmountRaw: string;
  /** Request echo, so prepare can re-quote the identical trade. */
  amountRaw: string;
  /** Slippage the user asked for; routes may never exceed it. */
  requestedSlippageBps: number;
  inputDecimals: number;
  outputDecimals: number;
  /**
   * Cached Jupiter quote for the same trade, used if the Titan route is
   * stale or fails at prepare time. Absent if Jupiter could not quote.
   */
  jupiterFallback?: Quote;
}
