import { Injectable } from '@nestjs/common';
import type { TokenizedEquity } from '../../../types/equity';
import type {
  PreparedTransaction,
  QuoteRequest,
} from '../../../types/execution';
import type { Quote, TradeSide } from '../../../types/quote';
import type { ExecutionProvider } from '../../../types/providers/execution-provider';
import {
  DEFAULT_SLIPPAGE_BPS,
  QUOTE_TTL_MS,
  USDC_DECIMALS,
  USDC_MINT,
} from '../../config/constants';
import {
  JupiterRateLimitedError,
  QuoteExpiredError,
} from '../../common/errors/provider.errors';
import type { RateLane } from '../../common/rate-limiter';
import { JupiterClient } from './jupiter.client';
import {
  mapJupiterQuoteToDomain,
  uiAmountToRaw,
} from './jupiter.mapper';
import type { JupiterQuoteRaw } from './jupiter.types';

export interface JupiterQuoteContext {
  side: TradeSide;
  assetId: string;
  ticker: string;
  variant: TokenizedEquity;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
  /** UI amount of input token (not raw). */
  amountUi: number;
  /** USD notional for Quote.amountUsd. */
  amountUsd: number;
  slippageBps?: number;
  /** 'background' for auto-refresh quotes; defaults to 'priority'. */
  lane?: RateLane;
}

@Injectable()
export class JupiterService implements ExecutionProvider {
  readonly name = 'jupiter';

  constructor(private readonly client: JupiterClient) {}

  /**
   * Low-level ExecutionProvider entry — mints only.
   * Equity metadata is filled with placeholders; prefer getQuoteWithContext.
   */
  async getQuote(input: QuoteRequest): Promise<Quote> {
    const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const inputDecimals =
      input.inputMint === USDC_MINT ? USDC_DECIMALS : USDC_DECIMALS;
    const outputDecimals =
      input.outputMint === USDC_MINT ? USDC_DECIMALS : USDC_DECIMALS;

    const placeholder: TokenizedEquity = {
      mint: input.side === 'buy' ? input.outputMint : input.inputMint,
      symbol: input.ticker ?? 'TOKEN',
      name: input.ticker ?? 'TOKEN',
      decimals: input.side === 'buy' ? outputDecimals : inputDecimals,
      tradable: true,
    };

    return this.getQuoteWithContext({
      side: input.side,
      assetId: input.assetId ?? 'unknown',
      ticker: input.ticker ?? 'UNKNOWN',
      variant: placeholder,
      inputSymbol: input.inputMint === USDC_MINT ? 'USDC' : placeholder.symbol,
      outputSymbol:
        input.outputMint === USDC_MINT ? 'USDC' : placeholder.symbol,
      inputDecimals,
      outputDecimals,
      amountUi: input.amount,
      amountUsd:
        input.inputMint === USDC_MINT ? input.amount : input.amount,
      slippageBps,
      inputMint: input.inputMint,
      outputMint: input.outputMint,
    });
  }

  async getQuoteWithContext(
    ctx: JupiterQuoteContext & { inputMint: string; outputMint: string },
  ): Promise<Quote> {
    const slippageBps = ctx.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
    const rawAmount = uiAmountToRaw(ctx.amountUi, ctx.inputDecimals);

    const raw = await this.client.getQuote({
      inputMint: ctx.inputMint,
      outputMint: ctx.outputMint,
      amount: rawAmount,
      slippageBps,
      lane: ctx.lane,
    });

    return mapJupiterQuoteToDomain({
      raw,
      side: ctx.side,
      assetId: ctx.assetId,
      ticker: ctx.ticker,
      variant: ctx.variant,
      inputSymbol: ctx.inputSymbol,
      outputSymbol: ctx.outputSymbol,
      inputDecimals: ctx.inputDecimals,
      outputDecimals: ctx.outputDecimals,
      amountUsd: ctx.amountUsd,
      slippageBps,
    });
  }

  async prepareSwap(
    quote: Quote,
    wallet: string,
  ): Promise<Omit<PreparedTransaction, 'executionId'>> {
    await this.validateQuote(quote);

    const quoteResponse = quote.routePayload as JupiterQuoteRaw | undefined;
    if (!quoteResponse || !quoteResponse.inAmount) {
      throw new QuoteExpiredError('Quote missing Jupiter route payload');
    }

    let swap;
    try {
      swap = await this.client.postSwap({
        quoteResponse,
        userPublicKey: wallet,
        useSharedAccounts: false,
      });
    } catch (err) {
      // Retrying a rate-limited request only burns more shared budget.
      if (err instanceof JupiterRateLimitedError) throw err;
      try {
        swap = await this.client.postSwap({ quoteResponse, userPublicKey: wallet });
      } catch (retryErr) {
        if (retryErr instanceof JupiterRateLimitedError) throw retryErr;
        // Attribution must never prevent a user from receiving a transaction.
        swap = await this.client.postSwap({
          quoteResponse,
          userPublicKey: wallet,
          trackingAccount: null,
        });
      }
    }

    if (!swap.swapTransaction) {
      throw new QuoteExpiredError('Jupiter did not return a swap transaction');
    }

    return {
      quoteId: quote.id,
      wallet,
      transaction: swap.swapTransaction,
      provider: this.name,
      expiresAt: quote.expiresAt,
    };
  }

  async validateQuote(quote: Quote): Promise<boolean> {
    if (!quote?.id || !quote.routePayload) {
      throw new QuoteExpiredError('Quote is incomplete');
    }
    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new QuoteExpiredError('Quote has expired');
    }
    // Soft TTL check against quotedAt as well
    if (
      quote.quotedAt &&
      Date.now() - quote.quotedAt.getTime() > QUOTE_TTL_MS + 5_000
    ) {
      throw new QuoteExpiredError('Quote has expired');
    }
    return true;
  }
}
