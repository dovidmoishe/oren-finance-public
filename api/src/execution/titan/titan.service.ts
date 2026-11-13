import { Injectable, Logger } from '@nestjs/common';
import bs58 from 'bs58';
import type { PreparedTransaction } from '../../../types/execution';
import type { Quote } from '../../../types/quote';
import { DEFAULT_SLIPPAGE_BPS, QUOTE_TTL_MS } from '../../config/constants';
import { QuoteExpiredError } from '../../common/errors/provider.errors';
import type { JupiterQuoteContext } from '../jupiter/jupiter.service';
import { uiAmountToRaw } from '../jupiter/jupiter.mapper';
import { TitanClient } from './titan.client';
import { TitanError } from './titan.errors';
import {
  isTitanPayload,
  mapTitanQuoteToDomain,
  optionalU64ToNumber,
} from './titan.mapper';
import { TitanTxBuilder } from './titan-tx.builder';
import type { TitanRoutePayload } from './titan.types';

export type TitanQuoteContext = JupiterQuoteContext & {
  inputMint: string;
  outputMint: string;
  wallet: string;
};

/** Treat a provider hard expiry this close as already expired. */
export const TITAN_EXPIRY_SAFETY_MS = 1_000;

/**
 * Titan as a swap venue. Quotes need the user's wallet (Titan builds
 * instructions for that wallet's token accounts); prepareSwap assembles a
 * v0 transaction locally so the approval pipeline is unchanged.
 */
@Injectable()
export class TitanService {
  readonly name = 'titan';
  private readonly logger = new Logger(TitanService.name);

  constructor(
    private readonly client: TitanClient,
    private readonly builder: TitanTxBuilder,
  ) {}

  get enabled(): boolean {
    return this.client.enabled;
  }

  /**
   * Quote for display/selection. Runs on the limiter's background lane, so
   * shadow traffic and auto-refreshes can never use the budget reserved for
   * prepare-time re-quotes.
   */
  async getQuoteWithContext(ctx: TitanQuoteContext): Promise<Quote> {
    if (!isValidWallet(ctx.wallet)) {
      throw new TitanError('no_wallet', 'Titan quotes require a valid wallet');
    }
    const slippageBps = ctx.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const amountRaw = uiAmountToRaw(ctx.amountUi, ctx.inputDecimals);
    const response = await this.client.quoteSwap(
      {
        inputMint: ctx.inputMint,
        outputMint: ctx.outputMint,
        amount: amountRaw,
        userPublicKey: ctx.wallet,
        slippageBps,
      },
      'background',
    );

    return mapTitanQuoteToDomain({
      response,
      side: ctx.side,
      assetId: ctx.assetId,
      ticker: ctx.ticker,
      variant: ctx.variant,
      inputMint: ctx.inputMint,
      outputMint: ctx.outputMint,
      inputSymbol: ctx.inputSymbol,
      outputSymbol: ctx.outputSymbol,
      inputDecimals: ctx.inputDecimals,
      outputDecimals: ctx.outputDecimals,
      amountUsd: ctx.amountUsd,
      slippageBps,
      amountRaw,
      wallet: ctx.wallet,
    });
  }

  /**
   * Re-quote the identical trade (same mints, raw amount, requested
   * slippage) for `wallet`, keeping the original quote's id/expiry so caches
   * stay keyed. Uses the reserved 'priority' budget.
   */
  async requote(quote: Quote, wallet: string): Promise<Quote> {
    if (!isTitanPayload(quote.routePayload)) {
      throw new QuoteExpiredError('Quote missing Titan route payload');
    }
    if (!isValidWallet(wallet)) {
      throw new TitanError('no_wallet', 'Titan quotes require a valid wallet');
    }
    const previous = quote.routePayload;
    const slippageBps = previous.requestedSlippageBps ?? quote.slippageBps;
    const response = await this.client.quoteSwap(
      {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        amount: previous.amountRaw,
        userPublicKey: wallet,
        slippageBps,
      },
      'priority',
    );
    const fresh = mapTitanQuoteToDomain({
      response,
      side: quote.side,
      assetId: quote.assetId,
      ticker: quote.ticker,
      variant: quote.variant,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputSymbol: quote.inputSymbol,
      outputSymbol: quote.outputSymbol,
      inputDecimals: previous.inputDecimals,
      outputDecimals: previous.outputDecimals,
      amountUsd: quote.amountUsd,
      slippageBps,
      amountRaw: previous.amountRaw,
      wallet,
      quoteId: quote.id,
    });
    (fresh.routePayload as TitanRoutePayload).jupiterFallback =
      previous.jupiterFallback;
    // Keep the reviewed quote's lifetime; only the route is refreshed.
    fresh.expiresAt = quote.expiresAt;
    return fresh;
  }

  async prepareSwap(
    quote: Quote,
    wallet: string,
  ): Promise<Omit<PreparedTransaction, 'executionId'>> {
    await this.validateQuote(quote);
    const payload = quote.routePayload as TitanRoutePayload;
    const built = await this.builder.build(payload, wallet);
    this.logger.log(
      JSON.stringify({
        event: 'titan_tx_built',
        quoteId: quote.id,
        titanQuoteId: payload.quoteId,
        provider: quote.provider,
        sizeBytes: built.sizeBytes,
        computeUnitLimit: built.computeUnitLimit,
        computeUnitPriceMicroLamports: built.computeUnitPriceMicroLamports,
        priorityFeeLamports: built.priorityFeeLamports,
        strippedComputeBudget: built.strippedComputeBudget,
      }),
    );
    return {
      quoteId: quote.id,
      wallet,
      transaction: built.transaction,
      provider: quote.provider,
      expiresAt: routeExpiry(quote, payload),
      expiresAfterSlot: built.expiresAfterSlot,
    };
  }

  async validateQuote(quote: Quote): Promise<boolean> {
    if (!quote?.id || !isTitanPayload(quote.routePayload)) {
      throw new QuoteExpiredError('Quote missing Titan route payload');
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new QuoteExpiredError('Quote has expired');
    }
    if (
      quote.quotedAt &&
      Date.now() - quote.quotedAt.getTime() > QUOTE_TTL_MS + 5_000
    ) {
      throw new QuoteExpiredError('Quote has expired');
    }
    return Promise.resolve(true);
  }
}

/**
 * The approval may not outlive the provider's hard expiry: min of our quote
 * TTL and the route's `expiresAtMs` (minus a safety margin).
 */
export function routeExpiry(quote: Quote, payload: TitanRoutePayload): Date {
  const hard = optionalU64ToNumber(payload.route.expiresAtMs);
  const ours = quote.expiresAt.getTime();
  if (hard === undefined || !(hard > 0)) return quote.expiresAt;
  return new Date(Math.min(ours, hard - TITAN_EXPIRY_SAFETY_MS));
}

export function isValidWallet(wallet: string | undefined): wallet is string {
  if (!wallet?.trim()) return false;
  try {
    return bs58.decode(wallet.trim()).length === 32;
  } catch {
    return false;
  }
}
