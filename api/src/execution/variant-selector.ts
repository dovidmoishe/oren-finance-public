import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Equity, TokenizedEquity } from '../../types/equity';
import type { TradeIntent } from '../../types/execution';
import type { Quote } from '../../types/quote';
import {
  MAX_VARIANT_QUOTES,
  USDC_DECIMALS,
  USDC_MINT,
  VARIANT_QUOTE_CONCURRENCY,
} from '../config/constants';
import {
  JupiterBadRequestError,
  TokensNotFoundError,
} from '../common/errors/provider.errors';
import { TokensService } from '../tokens/tokens.service';
import { StockDecimals } from './stock-decimals';
import { rawToQuoteAmount, stockSharesToRaw } from './scaled-amount';
import { SwapRouter, TITAN_MAX_VARIANT_QUOTES } from './swap-router';

export interface VariantSelectionResult {
  equity: Equity;
  variant: TokenizedEquity;
  quote: Quote;
}

@Injectable()
export class VariantSelector {
  private readonly logger = new Logger(VariantSelector.name);

  constructor(
    private readonly tokens: TokensService,
    private readonly router: SwapRouter,
    @Optional() private readonly decimals?: StockDecimals,
  ) {}

  async selectAndQuote(
    intent: TradeIntent,
    requirePreferredMint = false,
  ): Promise<VariantSelectionResult> {
    const equity = await this.resolveEquity(intent);
    const candidates = this.pickCandidates(
      equity,
      intent.preferredMint,
      requirePreferredMint,
    );

    if (candidates.length === 0) {
      throw new TokensNotFoundError(
        `No tradable variants for ${equity.ticker}`,
      );
    }

    const quotes = await this.quoteCandidates(equity, candidates, intent);
    if (quotes.length === 0) {
      throw new JupiterBadRequestError(`No swap routes for ${equity.ticker}`);
    }

    quotes.sort((a, b) => {
      if (b.quote.outputAmount !== a.quote.outputAmount) {
        return b.quote.outputAmount - a.quote.outputAmount;
      }
      return a.quote.priceImpactPercent - b.quote.priceImpactPercent;
    });

    return quotes[0];
  }

  /** Exported for unit tests — filter + rank without quoting. */
  pickCandidates(
    equity: Equity,
    preferredMint?: string,
    requirePreferredMint = false,
  ): TokenizedEquity[] {
    const tradable = equity.variants.filter((v) => v.tradable && v.mint);
    if (preferredMint) {
      const preferred = tradable.find((v) => v.mint === preferredMint);
      if (preferred) return [preferred];
      if (requirePreferredMint) return [];
    }
    return [...tradable]
      .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))
      .slice(0, MAX_VARIANT_QUOTES);
  }

  private async resolveEquity(intent: TradeIntent): Promise<Equity> {
    if (intent.assetId) {
      return this.tokens.getStock(intent.assetId);
    }
    const q = intent.ticker?.trim();
    if (!q) {
      throw new TokensNotFoundError('ticker or assetId is required');
    }
    const results = await this.tokens.searchStocks(q);
    const exact = results.find(
      (e) => e.ticker.toUpperCase() === q.toUpperCase(),
    );
    if (exact) return exact;
    if (results[0]) return results[0];
    throw new TokensNotFoundError(`Stock not found: ${q}`);
  }

  private async quoteCandidates(
    equity: Equity,
    candidates: TokenizedEquity[],
    intent: TradeIntent,
  ): Promise<VariantSelectionResult[]> {
    const results: VariantSelectionResult[] = [];

    // Candidates arrive liquidity-ranked; only the top few go to Titan.
    await mapPool(
      candidates,
      VARIANT_QUOTE_CONCURRENCY,
      async (variant, index) => {
        try {
          const quote = await this.buildQuoteForVariant(
            equity,
            variant,
            intent,
            intent.jupiterOnly ? false : index < TITAN_MAX_VARIANT_QUOTES,
          );
          results.push({ equity, variant, quote });
        } catch (err) {
          this.logger.warn(
            `Quote failed for ${variant.mint}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      },
    );

    return results;
  }

  /** The variant with its mint's real decimals; throws rather than guessing. */
  async withDecimals(variant: TokenizedEquity): Promise<TokenizedEquity> {
    return this.decimals ? this.decimals.forVariant(variant) : variant;
  }

  private async buildQuoteForVariant(
    equity: Equity,
    catalogVariant: TokenizedEquity,
    intent: TradeIntent,
    titanEligible: boolean,
  ): Promise<Quote> {
    const variant = await this.withDecimals(catalogVariant);
    const stockDecimals = variant.decimals ?? USDC_DECIMALS;
    const side = intent.side;

    if (side === 'buy') {
      const amountUsd = intent.amountUsd;
      if (amountUsd === undefined || amountUsd <= 0) {
        throw new JupiterBadRequestError('amountUsd is required for buys');
      }
      return this.router.quote({
        side: 'buy',
        assetId: equity.id,
        ticker: equity.ticker,
        variant,
        inputMint: USDC_MINT,
        outputMint: variant.mint,
        inputSymbol: 'USDC',
        outputSymbol: variant.symbol,
        inputDecimals: USDC_DECIMALS,
        outputDecimals: stockDecimals,
        amountUi: amountUsd,
        amountUsd,
        slippageBps: intent.slippageBps,
        wallet: intent.wallet,
        titanEligible,
        lane: intent.autoRefresh ? 'background' : 'priority',
      });
    }

    const amount = intent.amount;
    if (amount === undefined || amount <= 0) {
      throw new JupiterBadRequestError('amount is required for sells');
    }
    // Rough USD estimate from equity price if available
    const amountUsd =
      intent.amountUsd ??
      (equity.price !== undefined ? amount * equity.price : 0);

    return this.router.quote({
      side: 'sell',
      assetId: equity.id,
      ticker: equity.ticker,
      variant,
      inputMint: variant.mint,
      outputMint: USDC_MINT,
      inputSymbol: variant.symbol,
      outputSymbol: 'USDC',
      inputDecimals: stockDecimals,
      outputDecimals: USDC_DECIMALS,
      amountUi: scaledSellAmount(amount, stockDecimals, variant.uiMultiplier),
      amountUsd,
      slippageBps: intent.slippageBps,
      wallet: intent.wallet,
      titanEligible,
      lane: intent.autoRefresh ? 'background' : 'priority',
    });
  }
}

/**
 * Shares the user asked to sell, as the unscaled amount the swap converts to
 * raw units. xStocks show raw * multiplier, so the raw amount is divided by it
 * and rounded down; otherwise "sell all" asks for more than the wallet holds.
 */
export function scaledSellAmount(
  shares: number,
  decimals: number,
  multiplier: number | undefined,
): number {
  if (!multiplier || multiplier === 1) return shares;
  try {
    return rawToQuoteAmount(
      stockSharesToRaw(shares, decimals, multiplier),
      decimals,
    );
  } catch (error) {
    throw new JupiterBadRequestError(
      error instanceof Error ? error.message : 'Invalid share amount',
    );
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      await fn(items[current], current);
    }
  }
  const n = Math.min(concurrency, items.length);
  if (n === 0) return;
  await Promise.all(Array.from({ length: n }, () => worker()));
}
