import type { Quote } from '../quote';
import type { PreparedTransaction, QuoteRequest } from '../execution';

/**
 * Swap / liquidity venue adapter.
 * MVP implementation: Jupiter (via JupiterService).
 * Kept thin so future venues (xChange, Ondo, RFQ) can plug in later.
 */
export interface ExecutionProvider {
  readonly name: string;

  getQuote(input: QuoteRequest): Promise<Quote>;

  prepareSwap(
    quote: Quote,
    wallet: string,
  ): Promise<Omit<PreparedTransaction, 'executionId'>>;

  validateQuote?(quote: Quote): Promise<boolean>;
}
