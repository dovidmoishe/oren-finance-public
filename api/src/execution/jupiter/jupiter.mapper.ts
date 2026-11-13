import { randomUUID } from 'crypto';
import type { TokenizedEquity } from '../../../types/equity';
import type { Quote, TradeSide } from '../../../types/quote';
import { QUOTE_TTL_MS } from '../../config/constants';
import type { JupiterQuoteRaw } from './jupiter.types';

export interface MapJupiterQuoteInput {
  raw: JupiterQuoteRaw;
  side: TradeSide;
  assetId: string;
  ticker: string;
  variant: TokenizedEquity;
  inputSymbol: string;
  outputSymbol: string;
  inputDecimals: number;
  outputDecimals: number;
  /** Indicative USD notional for the trade (buy: spend; sell: proceeds estimate). */
  amountUsd: number;
  slippageBps: number;
  quoteId?: string;
  quotedAt?: Date;
  expiresAt?: Date;
}

export function rawAmountToUi(raw: string, decimals: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return value / 10 ** decimals;
}

export function uiAmountToRaw(ui: number, decimals: number): string {
  if (!Number.isFinite(ui) || ui <= 0) {
    throw new Error('Amount must be a positive number');
  }
  const factor = 10 ** decimals;
  return String(Math.round(ui * factor));
}

/**
 * Jupiter `priceImpactPct` is a ratio from 0 to 1, not a percentage.
 * `0.01` means 1%. Store percentage points so `1` means 1% for both venues.
 */
export function parsePriceImpactPercent(
  value: string | number | undefined,
): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n * 100 : 0;
}

/**
 * Map Jupiter /quote JSON into domain Quote.
 * `routePayload` stores the full raw response for /swap.
 */
export function mapJupiterQuoteToDomain(input: MapJupiterQuoteInput): Quote {
  const now = input.quotedAt ?? new Date();
  const expiresAt =
    input.expiresAt ?? new Date(now.getTime() + QUOTE_TTL_MS);

  const inputAmount = rawAmountToUi(input.raw.inAmount, input.inputDecimals);
  const outputAmount = rawAmountToUi(
    input.raw.outAmount,
    input.outputDecimals,
  );

  let estimatedPriceUsd = 0;
  if (input.side === 'buy' && outputAmount > 0) {
    estimatedPriceUsd = input.amountUsd / outputAmount;
  } else if (input.side === 'sell' && outputAmount > 0) {
    // output is USDC
    estimatedPriceUsd = outputAmount / (inputAmount || 1);
  }

  return {
    id: input.quoteId ?? randomUUID(),
    side: input.side,
    assetId: input.assetId,
    ticker: input.ticker,
    variant: input.variant,
    inputMint: input.raw.inputMint,
    outputMint: input.raw.outputMint,
    inputSymbol: input.inputSymbol,
    outputSymbol: input.outputSymbol,
    inputAmount,
    outputAmount,
    estimatedPriceUsd,
    amountUsd: input.amountUsd,
    priceImpactPercent: parsePriceImpactPercent(input.raw.priceImpactPct),
    slippageBps: input.slippageBps,
    provider: 'jupiter',
    routePayload: input.raw,
    expiresAt,
    quotedAt: now,
  };
}
