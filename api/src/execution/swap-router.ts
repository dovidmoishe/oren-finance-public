import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PreparedTransaction } from '../../types/execution';
import type { Quote } from '../../types/quote';
import { APP_ENV } from '../config/constants';
import type { AppEnv, SwapRouterMode } from '../config/env.schema';
import {
  PriceMovedError,
  type PriceMovedDetails,
  type PriceMovedTerms,
  QuoteExpiredError,
} from '../common/errors/provider.errors';
import { stampQuoteMarketSession } from '../market/us-market-session';
import {
  JupiterService,
  type JupiterQuoteContext,
} from './jupiter/jupiter.service';
import { rawAmountToUi } from './jupiter/jupiter.mapper';
import type { JupiterQuoteRaw } from './jupiter/jupiter.types';
import { type FeeSnapshot, SwapFeeOracle } from './swap-fee-oracle';
import {
  enforcedMinimumOut,
  expectationFor,
  minimumOut,
  publicQuote,
  rawIn,
  rawOut,
  type ReviewedTerms,
  reviewedTermsFor,
  type SwapExpectation,
} from './swap-terms';
import { TitanError, titanErrorCode } from './titan/titan.errors';
import { isTitanPayload, optionalU64ToNumber } from './titan/titan.mapper';
import { isValidWallet, TitanService } from './titan/titan.service';
import { routeProgramIds } from './titan/titan-tx.builder';
import type { TitanRoutePayload } from './titan/titan.types';

export { minimumOut, rawOut };

/** Only the most liquid N variants of a stock are sent to Titan. */
export const TITAN_MAX_VARIANT_QUOTES = 2;
/** Titan routes older than this are re-quoted at prepare time. */
export const TITAN_REQUOTE_AFTER_MS = 5_000;
/** Treat a provider hard expiry this close as already expired. */
const TITAN_EXPIRY_SAFETY_MS = 1_000;

/**
 * Best-mode network-fee estimate. Both venues are charged the same live
 * priority price per CU (SwapFeeOracle); Titan routes use their
 * `computeUnitsSafe`, Jupiter an assumed typical swap size (Jupiter picks
 * its own limit via dynamicComputeUnitLimit).
 */
export const JUPITER_ESTIMATED_COMPUTE_UNITS = 300_000;
const BASE_FEE_LAMPORTS = 5_000;
/** Titan must beat Jupiter by at least this much after fees (bps). */
export const TITAN_MIN_NET_EDGE_BPS = 1;

export type RouterQuoteContext = JupiterQuoteContext & {
  inputMint: string;
  outputMint: string;
  /** User wallet — Titan cannot quote without it. */
  wallet?: string;
  /** False for lower-ranked variants to conserve Titan's rate budget. */
  titanEligible?: boolean;
};

interface Timed<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  latencyMs: number;
}

export interface RouterPrepareResult {
  prepared: Omit<PreparedTransaction, 'executionId'>;
  /** The quote that will actually execute (full, server-side). */
  quote: Quote;
  /** Balance expectations for the simulation check before signing. */
  expectation?: SwapExpectation;
}

export interface QuoteComparisonRow {
  event: 'swap_quote_comparison';
  mode: SwapRouterMode;
  ticker: string;
  assetId: string;
  side: string;
  inputMint: string;
  outputMint: string;
  variantMint: string;
  amountRaw?: string;
  amountUi: number;
  slippageBps: number;
  hasWallet: boolean;
  jupiterOutAmount?: string;
  jupiterLatencyMs?: number;
  jupiterError?: string;
  titanOutAmount?: string;
  titanWinner?: string;
  titanQuoteId?: string;
  titanLatencyMs?: number;
  titanErrorCode?: string;
  titanError?: string;
  /** Program ids the Titan route uses (to review the allowlist). */
  titanPrograms?: string[];
  /** (titan − jupiter) / jupiter in bps; positive = Titan pays more. */
  deltaBps?: number;
  /** deltaBps minus the estimated extra network fee for Titan, in bps. */
  netDeltaBps?: number;
  /** 'live' when SOL/USD and priority fee were available, else 'unavailable'. */
  feeBasis?: 'live' | 'unavailable';
  solUsd?: number;
  priorityMicroLamports?: number;
  selected: 'jupiter' | 'titan' | 'none';
}

/**
 * Chooses the venue for market swaps.
 *
 * - `jupiter`: Jupiter only (also forced when TITAN_API_KEY is unset).
 * - `shadow`: quote both; log the comparison; always return Jupiter.
 *   Titan never adds latency — the log is written when it settles.
 * - `best`:   quote both in parallel, return Titan only if it beats Jupiter
 *   net of the estimated network fee. Any Titan error / timeout / 429 /
 *   missing wallet / open breaker → Jupiter.
 *
 * At prepare time every venue is held to the minimum the user reviewed
 * (captured once by the QuoteCache): a re-quote or fallback that would
 * enforce less on-chain is refused with PriceMovedError.
 */
@Injectable()
export class SwapRouter {
  private readonly logger = new Logger(SwapRouter.name);
  private readonly configuredMode: SwapRouterMode;
  /** Overridable in tests. */
  now: () => number = Date.now;

  constructor(
    private readonly jupiter: JupiterService,
    private readonly titan: TitanService,
    @Inject(APP_ENV) env: AppEnv,
    private readonly fees: SwapFeeOracle,
  ) {
    this.configuredMode = env.SWAP_ROUTER_MODE ?? 'jupiter';
    if (this.configuredMode !== 'jupiter' && !this.titan.enabled) {
      this.logger.warn(
        `SWAP_ROUTER_MODE=${this.configuredMode} but TITAN_API_KEY is unset; routing Jupiter only`,
      );
    }
  }

  /** Effective mode after the kill switch. */
  get mode(): SwapRouterMode {
    return this.titan.enabled ? this.configuredMode : 'jupiter';
  }

  async quote(ctx: RouterQuoteContext): Promise<Quote> {
    const mode = this.mode;
    // In-chat signing can only sign Jupiter. Skip Titan for that path,
    // including a re-quote of the same trade. Browser review leaves
    // titanEligible unset and keeps best-of routing.
    if (mode === 'jupiter' || ctx.titanEligible === false) {
      return this.jupiter.getQuoteWithContext(ctx);
    }

    const jupiterP = this.timed(() => this.jupiter.getQuoteWithContext(ctx));
    const titanP = isValidWallet(ctx.wallet)
      ? this.timed(() =>
          this.titan.getQuoteWithContext({ ...ctx, wallet: ctx.wallet! }),
        )
      : Promise.resolve<Timed<Quote>>({
          ok: false,
          error: new TitanError('no_wallet', 'no wallet on quote'),
          latencyMs: 0,
        });

    if (mode === 'shadow') {
      void Promise.all([jupiterP, titanP]).then(async ([j, t]) => {
        const fees = j.ok && t.ok ? await this.feeSnapshot() : undefined;
        this.logComparison(mode, ctx, j, t, j.ok ? 'jupiter' : 'none', fees);
      });
      const j = await jupiterP;
      if (!j.ok) throw j.error;
      return j.value!;
    }

    const feesP = this.feeSnapshot();
    const [j, initialTitan] = await Promise.all([jupiterP, titanP]);
    let t = initialTitan;
    const fees = j.ok && t.ok ? await feesP : undefined;
    // A slow Jupiter response can outlive Titan's route or our quote TTL.
    // This is still quote selection: request a new quote with its own lifetime,
    // rather than prepare-time requote(), which preserves the original expiry.
    if (t.ok && !this.freshForSelection(t.value!, ctx.wallet!)) {
      t = await this.timed(async () => {
        const fresh = await this.titan.getQuoteWithContext({
          ...ctx,
          wallet: ctx.wallet!,
        });
        if (!this.freshForSelection(fresh, ctx.wallet!)) {
          throw new TitanError(
            'stale_quote',
            'Titan returned an expired route',
          );
        }
        return fresh;
      });
    }
    let titanWins = t.ok && !j.ok;
    if (t.ok && j.ok) {
      // Fail safe: without live fee inputs Titan is never picked on a
      // fee-adjusted basis — Jupiter keeps the trade.
      titanWins =
        fees !== undefined &&
        netEdgeBps(t.value!, j.value!, ctx.amountUsd, fees) >
          TITAN_MIN_NET_EDGE_BPS;
    }
    this.logComparison(
      mode,
      ctx,
      j,
      t,
      titanWins ? 'titan' : j.ok ? 'jupiter' : 'none',
      fees,
    );

    if (titanWins) {
      const quote = t.value!;
      if (j.ok) {
        (quote.routePayload as TitanRoutePayload).jupiterFallback = j.value;
      }
      return quote;
    }
    if (j.ok) return j.value!;
    throw j.error;
  }

  private async feeSnapshot(): Promise<FeeSnapshot | undefined> {
    try {
      return await this.fees.snapshot();
    } catch {
      return undefined;
    }
  }

  /**
   * Build the transaction for a cached quote.
   *
   * `reviewed` are the terms captured when the quote was first issued; the
   * executed route must enforce at least `reviewed.minOutRaw` on-chain and
   * use no more than `reviewed.slippageBps`. Returns the quote that will
   * actually execute (may be a refreshed Titan route or the Jupiter
   * fallback) so callers bind the approval to exactly that.
   */
  async prepare(
    quote: Quote,
    wallet: string,
    reviewed: ReviewedTerms | undefined = reviewedTermsFor(quote),
  ): Promise<RouterPrepareResult> {
    const meets = (q: Quote): boolean => meetsReviewed(q, reviewed);

    if (!isTitanPayload(quote.routePayload)) {
      if (!meets(quote)) {
        this.logPrepare(quote, undefined, false, 'below_reviewed_minimum');
        throw new PriceMovedError();
      }
      await this.jupiter.validateQuote(quote);
      const prepared = await this.jupiter.prepareSwap(quote, wallet);
      return { prepared, quote, expectation: expectationFor(quote, reviewed) };
    }

    const payload = quote.routePayload;
    let requoted = false;
    let belowFloor = false;
    let latest: Quote | undefined;
    let fallbackReason: string | undefined;

    const requote = async (): Promise<Quote | undefined> => {
      requoted = true;
      try {
        const fresh = await this.titan.requote(quote, wallet);
        if (meets(fresh)) return fresh;
        belowFloor = true;
        latest = fresh;
        fallbackReason = 'requote_below_reviewed_minimum';
      } catch (err) {
        fallbackReason = `requote_failed:${titanErrorCode(err)}`;
      }
      return undefined;
    };

    let candidate: Quote | undefined;
    if (this.needsRequote(payload, wallet)) {
      candidate = await requote();
    } else if (meets(quote)) {
      candidate = quote;
    } else {
      belowFloor = true;
      latest = quote;
      fallbackReason = 'cached_below_reviewed_minimum';
    }

    while (candidate) {
      try {
        const prepared = await this.titan.prepareSwap(candidate, wallet);
        this.logPrepare(quote, candidate, requoted);
        return {
          prepared,
          quote: candidate,
          expectation: expectationFor(candidate, reviewed),
        };
      } catch (err) {
        const code = titanErrorCode(err);
        fallbackReason = `build_failed:${code}`;
        this.logger.warn(
          `Titan prepare failed for ${quote.id}: ${errorMessage(err)}`,
        );
        // A slot-expired route gets exactly one fresh attempt.
        candidate =
          code === 'stale_quote' && !requoted ? await requote() : undefined;
      }
    }

    const fallback = payload.jupiterFallback;
    if (fallback) {
      const jupiterQuote: Quote = {
        ...fallback,
        id: quote.id,
        expiresAt: quote.expiresAt,
      };
      if (meets(jupiterQuote)) {
        await this.jupiter.validateQuote(jupiterQuote);
        const prepared = await this.jupiter.prepareSwap(jupiterQuote, wallet);
        this.logPrepare(quote, jupiterQuote, requoted, fallbackReason);
        return {
          prepared,
          quote: jupiterQuote,
          expectation: expectationFor(jupiterQuote, reviewed),
        };
      }
      belowFloor = true;
      latest ??= jupiterQuote;
      fallbackReason = `${fallbackReason ?? 'titan_unavailable'};jupiter_below_reviewed_minimum`;
    }

    this.logPrepare(quote, undefined, requoted, fallbackReason);
    if (belowFloor) {
      throw await this.priceMoved(quote, payload, reviewed, latest);
    }
    throw new QuoteExpiredError(
      'This route expired before it could be prepared. Request a fresh quote.',
    );
  }

  /**
   * PRICE_MOVED for a Titan quote, with a fresh Jupiter quote for the same
   * trade as an alternative the user may review. The alternative is never
   * executed here — the client must start a new review/approval for it.
   */
  private async priceMoved(
    quote: Quote,
    payload: TitanRoutePayload,
    reviewed: ReviewedTerms | undefined,
    latest: Quote | undefined,
  ): Promise<PriceMovedError> {
    const decimals = payload.outputDecimals;
    const reviewedTerms: PriceMovedTerms = {
      provider: reviewed?.provider ?? quote.provider,
      outputAmount: reviewed?.outputAmount ?? quote.outputAmount,
      minOutRaw:
        reviewed?.minOutRaw ?? (enforcedMinimumOut(quote) ?? 0n).toString(),
      minimumOutputAmount: rawAmountToUi(
        reviewed?.minOutRaw ?? (enforcedMinimumOut(quote) ?? 0n).toString(),
        decimals,
      ),
      slippageBps: reviewed?.slippageBps ?? quote.slippageBps,
      outputSymbol: quote.outputSymbol,
    };
    let alternative: Quote | undefined;
    try {
      const quoted = await this.jupiter.getQuoteWithContext({
        side: quote.side,
        assetId: quote.assetId,
        ticker: quote.ticker,
        variant: quote.variant,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inputSymbol: quote.inputSymbol,
        outputSymbol: quote.outputSymbol,
        inputDecimals: payload.inputDecimals,
        outputDecimals: decimals,
        amountUi: rawAmountToUi(payload.amountRaw, payload.inputDecimals),
        amountUsd: quote.amountUsd,
        slippageBps: reviewedTerms.slippageBps,
      });
      alternative = quoted ? stampQuoteMarketSession(quoted) : undefined;
    } catch (err) {
      this.logger.warn(
        `Jupiter alternative for ${quote.id} unavailable: ${errorMessage(err)}`,
      );
    }
    const altMin = alternative ? enforcedMinimumOut(alternative) : undefined;
    const details: PriceMovedDetails = {
      quoteId: quote.id,
      reviewed: reviewedTerms,
      latest: latest ? termsOf(latest, decimals) : undefined,
      alternative:
        alternative && altMin !== undefined
          ? {
              ...publicQuote(alternative),
              minOutRaw: altMin.toString(),
              minimumOutputAmount: rawAmountToUi(altMin.toString(), decimals),
            }
          : undefined,
    };
    this.logger.log(
      JSON.stringify({
        event: 'swap_price_moved',
        quoteId: quote.id,
        reviewedMinOut: reviewedTerms.minOutRaw,
        latestMinOut: details.latest?.minOutRaw,
        alternativeQuoteId: details.alternative?.id,
        alternativeMinOut: details.alternative?.minOutRaw,
      }),
    );
    return new PriceMovedError(
      undefined,
      undefined,
      details,
      details.alternative ? alternative : undefined,
    );
  }

  private needsRequote(payload: TitanRoutePayload, wallet: string): boolean {
    const now = this.now();
    if (payload.wallet !== wallet) return true;
    if (now - payload.quotedAtMs > TITAN_REQUOTE_AFTER_MS) return true;
    const hardExpiry = optionalU64ToNumber(payload.route.expiresAtMs);
    return (
      hardExpiry !== undefined &&
      hardExpiry > 0 &&
      now >= hardExpiry - TITAN_EXPIRY_SAFETY_MS
    );
  }

  private freshForSelection(quote: Quote, wallet: string): boolean {
    return (
      quote.expiresAt.getTime() > this.now() + TITAN_EXPIRY_SAFETY_MS &&
      isTitanPayload(quote.routePayload) &&
      !this.needsRequote(quote.routePayload, wallet)
    );
  }

  private async timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
    const started = this.now();
    try {
      const value = await fn();
      return { ok: true, value, latencyMs: this.now() - started };
    } catch (error) {
      return { ok: false, error, latencyMs: this.now() - started };
    }
  }

  private logComparison(
    mode: SwapRouterMode,
    ctx: RouterQuoteContext,
    j: Timed<Quote>,
    t: Timed<Quote>,
    selected: QuoteComparisonRow['selected'],
    fees?: FeeSnapshot,
  ) {
    try {
      this.logger.log(
        JSON.stringify(buildComparisonRow(mode, ctx, j, t, selected, fees)),
      );
    } catch (err) {
      this.logger.warn(`comparison log failed: ${errorMessage(err)}`);
    }
  }

  private logPrepare(
    reviewed: Quote,
    executed: Quote | undefined,
    requoted: boolean,
    fallbackReason?: string,
  ) {
    this.logger.log(
      JSON.stringify({
        event: 'swap_prepare_route',
        quoteId: reviewed.id,
        ticker: reviewed.ticker,
        reviewedProvider: reviewed.provider,
        executedProvider: executed?.provider ?? 'none',
        requoted,
        fallbackReason,
        reviewedOutAmount: rawOut(reviewed),
        executedOutAmount: executed ? rawOut(executed) : undefined,
      }),
    );
  }
}

/**
 * True when `quote` enforces at least the reviewed minimum on-chain and its
 * slippage does not exceed what the user reviewed. Unknown amounts (no raw
 * payload) cannot be checked and are allowed only when nothing was reviewed.
 */
export function meetsReviewed(
  quote: Quote,
  reviewed: ReviewedTerms | undefined,
): boolean {
  if (!reviewed) return true;
  const enforced = enforcedMinimumOut(quote);
  if (enforced === undefined) return false;
  return (
    enforced >= BigInt(reviewed.minOutRaw) &&
    quote.slippageBps <= reviewed.slippageBps
  );
}

function termsOf(quote: Quote, outputDecimals: number): PriceMovedTerms {
  const min = (enforcedMinimumOut(quote) ?? 0n).toString();
  return {
    provider: quote.provider,
    outputAmount: quote.outputAmount,
    minOutRaw: min,
    minimumOutputAmount: rawAmountToUi(min, outputDecimals),
    slippageBps: quote.slippageBps,
    outputSymbol: quote.outputSymbol,
  };
}

/**
 * Network fee (lamports) the quote's execution should cost at the live
 * priority price.
 */
export function estimateNetworkFeeLamports(
  quote: Quote,
  priorityMicroLamports: number,
): number {
  const payload = quote.routePayload;
  const units = isTitanPayload(payload)
    ? (optionalU64ToNumber(payload.route.computeUnitsSafe) ??
      optionalU64ToNumber(payload.route.computeUnits) ??
      JUPITER_ESTIMATED_COMPUTE_UNITS)
    : JUPITER_ESTIMATED_COMPUTE_UNITS;
  return (
    BASE_FEE_LAMPORTS +
    Math.ceil((Math.min(units, 1_400_000) * priorityMicroLamports) / 1e6)
  );
}

/**
 * Titan's advantage over Jupiter in bps of output, net of the extra network
 * fee Titan's route costs, converted to bps of the trade's USD notional at
 * the live SOL price. Positive = Titan better.
 */
export function netEdgeBps(
  titan: Quote,
  jupiter: Quote,
  amountUsd: number,
  fees: FeeSnapshot,
): number {
  const gross = grossDeltaBps(titan, jupiter);
  if (gross === undefined) {
    return compareOut(titan, jupiter) > 0 ? Number.POSITIVE_INFINITY : -1;
  }
  const extraLamports =
    estimateNetworkFeeLamports(titan, fees.priorityMicroLamports) -
    estimateNetworkFeeLamports(jupiter, fees.priorityMicroLamports);
  const notional = amountUsd > 0 ? amountUsd : titan.amountUsd;
  const penalty =
    notional > 0
      ? ((extraLamports / 1e9) * fees.solUsd * 10_000) / notional
      : 0;
  return gross - penalty;
}

function grossDeltaBps(a: Quote, b: Quote): number | undefined {
  const aOut = rawOut(a);
  const bOut = rawOut(b);
  if (!aOut || !bOut || BigInt(bOut) <= 0n) return undefined;
  return (
    Number(((BigInt(aOut) - BigInt(bOut)) * 1_000_000n) / BigInt(bOut)) / 100
  );
}

export function buildComparisonRow(
  mode: SwapRouterMode,
  ctx: RouterQuoteContext,
  j: Timed<Quote>,
  t: Timed<Quote>,
  selected: QuoteComparisonRow['selected'],
  fees?: FeeSnapshot,
): QuoteComparisonRow {
  const jOut = j.ok ? rawOut(j.value!) : undefined;
  const tPayload = t.ok
    ? (t.value!.routePayload as TitanRoutePayload)
    : undefined;
  const tOut = tPayload?.outAmountRaw;
  const row: QuoteComparisonRow = {
    event: 'swap_quote_comparison',
    mode,
    ticker: ctx.ticker,
    assetId: ctx.assetId,
    side: ctx.side,
    inputMint: ctx.inputMint,
    outputMint: ctx.outputMint,
    variantMint: ctx.variant.mint,
    amountRaw: j.ok
      ? (j.value!.routePayload as JupiterQuoteRaw | undefined)?.inAmount
      : tPayload?.amountRaw,
    amountUi: ctx.amountUi,
    slippageBps: ctx.slippageBps ?? 0,
    hasWallet: isValidWallet(ctx.wallet),
    jupiterOutAmount: jOut,
    jupiterLatencyMs: j.latencyMs,
    jupiterError: j.ok ? undefined : errorMessage(j.error).slice(0, 200),
    titanOutAmount: tOut,
    titanWinner: tPayload?.providerId,
    titanQuoteId: tPayload?.quoteId,
    titanLatencyMs: t.latencyMs,
    titanErrorCode: t.ok ? undefined : titanErrorCode(t.error),
    titanError: t.ok ? undefined : errorMessage(t.error).slice(0, 200),
    titanPrograms: tPayload
      ? routeProgramIds(tPayload.route.instructions)
      : undefined,
    selected,
  };
  if (j.ok && t.ok) {
    row.deltaBps = grossDeltaBps(t.value!, j.value!);
    row.feeBasis = fees ? 'live' : 'unavailable';
    if (fees) {
      row.solUsd = fees.solUsd;
      row.priorityMicroLamports = fees.priorityMicroLamports;
      const net = netEdgeBps(t.value!, j.value!, ctx.amountUsd, fees);
      if (Number.isFinite(net)) row.netDeltaBps = Math.round(net * 100) / 100;
    }
  }
  return row;
}

/**
 * Compare two quotes for the same trade by raw outAmount, normalised by
 * inAmount in case a venue consumed a different input. >0 means `a` wins.
 */
export function compareOut(a: Quote, b: Quote): number {
  const aOut = rawOut(a);
  const bOut = rawOut(b);
  if (!aOut || !bOut) return a.outputAmount - b.outputAmount;
  const aIn = BigInt(rawIn(a) ?? '1');
  const bIn = BigInt(rawIn(b) ?? '1');
  const lhs = BigInt(aOut) * bIn;
  const rhs = BigInt(bOut) * aIn;
  return lhs > rhs ? 1 : lhs < rhs ? -1 : 0;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown })?.message;
  return typeof message === 'string' ? message : String(err);
}
