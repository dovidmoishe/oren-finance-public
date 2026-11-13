import type { Quote } from '../../types/quote';
import type { JupiterQuoteRaw } from './jupiter/jupiter.types';
import { isTitanPayload } from './titan/titan.mapper';

/**
 * Venue-neutral helpers for the amounts a swap quote commits to.
 * Everything here works in raw smallest units (bigint / decimal strings).
 */

/** What the user saw and accepted when the quote was issued. Never lowered. */
export interface ReviewedTerms {
  /** Smallest acceptable output (raw units) the user reviewed. */
  minOutRaw: string;
  /** Slippage the user asked for. Executed routes may not exceed it. */
  slippageBps: number;
  provider: string;
  /** Expected output (UI units) the user saw; for PRICE_MOVED displays. */
  outputAmount?: number;
}

/**
 * Balance-change expectations checked against a simulation of the exact
 * transaction the user signs (see ApprovalRpc.inspect).
 */
export interface SwapExpectation {
  inputMint: string;
  outputMint: string;
  /** Most of the input token the wallet may spend (raw units). */
  maxInRaw: string;
  /** Least output the wallet must receive (raw units). */
  minOutRaw: string;
}

/** outAmount × (1 − slippage), floored. */
export function minimumOut(outAmountRaw: string, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (BigInt(outAmountRaw) * (10_000n - bps)) / 10_000n;
}

/** Smallest-unit expected outAmount for either provider's quote. */
export function rawOut(quote: Quote): string | undefined {
  const payload = quote.routePayload;
  if (isTitanPayload(payload)) return payload.outAmountRaw;
  const out = (payload as JupiterQuoteRaw | undefined)?.outAmount;
  return typeof out === 'string' || typeof out === 'number'
    ? String(out)
    : undefined;
}

/** Smallest-unit input amount for either provider's quote. */
export function rawIn(quote: Quote): string | undefined {
  const payload = quote.routePayload;
  if (isTitanPayload(payload)) return payload.inAmountRaw;
  const value = (payload as JupiterQuoteRaw | undefined)?.inAmount;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

/**
 * The minimum output the venue's instructions will actually enforce
 * on-chain for this quote:
 * - Titan: route outAmount × (1 − route slippage) (the route's own slippage,
 *   which the mapper already guarantees is ≤ the requested slippage).
 * - Jupiter (ExactIn): `otherAmountThreshold`, else outAmount × (1 − slippage).
 */
export function enforcedMinimumOut(quote: Quote): bigint | undefined {
  const payload = quote.routePayload;
  if (isTitanPayload(payload)) {
    return minimumOut(payload.outAmountRaw, payload.route.slippageBps);
  }
  const raw = payload as JupiterQuoteRaw | undefined;
  if (!raw) return undefined;
  const threshold = raw.otherAmountThreshold;
  if (
    (raw.swapMode === undefined || raw.swapMode === 'ExactIn') &&
    typeof threshold === 'string' &&
    /^\d+$/.test(threshold)
  ) {
    return BigInt(threshold);
  }
  const out = rawOut(quote);
  return out && /^\d+$/.test(out)
    ? minimumOut(out, raw.slippageBps ?? quote.slippageBps)
    : undefined;
}

/** Terms to remember at quote time; `undefined` if amounts are unknown. */
export function reviewedTermsFor(quote: Quote): ReviewedTerms | undefined {
  const min = enforcedMinimumOut(quote);
  if (min === undefined) return undefined;
  const payload = quote.routePayload;
  return {
    minOutRaw: min.toString(),
    // The slippage the user asked for (a Titan route may use less).
    slippageBps: isTitanPayload(payload)
      ? (payload.requestedSlippageBps ?? quote.slippageBps)
      : quote.slippageBps,
    provider: quote.provider,
    outputAmount: quote.outputAmount,
  };
}

export function expectationFor(
  quote: Quote,
  reviewed: ReviewedTerms | undefined,
): SwapExpectation | undefined {
  const maxIn = rawIn(quote);
  const enforced = enforcedMinimumOut(quote);
  if (!maxIn || enforced === undefined) return undefined;
  const floor = reviewed ? BigInt(reviewed.minOutRaw) : enforced;
  return {
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    maxInRaw: maxIn,
    // Never expect less than either the reviewed floor or the route's own.
    minOutRaw: (floor > enforced ? floor : enforced).toString(),
  };
}

/** Quote as returned to clients: the route payload stays server-side. */
export function publicQuote<T extends Quote | undefined>(quote: T): T {
  if (!quote) return quote;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { routePayload, ...rest } = quote;
  return rest as T;
}
