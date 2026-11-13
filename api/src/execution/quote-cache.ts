import { Injectable } from '@nestjs/common';
import type { Quote } from '../../types/quote';
import {
  PENDING_EXECUTION_TTL_MS,
  QUOTE_TTL_MS,
} from '../config/constants';
import { QuoteExpiredError } from '../common/errors/provider.errors';
import { type ReviewedTerms, reviewedTermsFor } from './swap-terms';

export interface CachedQuoteEntry {
  quote: Quote;
  /** Set after prepare. */
  executionId?: string;
  /**
   * Terms of the quote as first issued to the user. Captured once in `set`
   * and never changed by `replace`, so a later prepare cannot lower the
   * floor (re-quotes and fallbacks are judged against this).
   */
  readonly reviewed?: ReviewedTerms;
  storedAt: number;
}

@Injectable()
export class QuoteCache {
  private readonly quotes = new Map<string, CachedQuoteEntry>();
  private readonly pendingByQuoteId = new Map<
    string,
    {
      executionId: string;
      wallet: string;
      /** Unsigned transaction the wallet must sign. */
      transaction: string;
      expiresAt: number;
    }
  >();

  set(quote: Quote): void {
    // Re-setting an id never resets the floor the user already reviewed.
    const existing = this.quotes.get(quote.id);
    this.quotes.set(quote.id, {
      quote,
      storedAt: Date.now(),
      reviewed: existing?.reviewed ?? reviewedTermsFor(quote),
    });
  }

  get(quoteId: string): CachedQuoteEntry {
    const entry = this.quotes.get(quoteId);
    if (!entry) {
      throw new QuoteExpiredError(
        `Quote not found: ${quoteId}. Refresh the quote or basket and try again.`,
      );
    }
    if (entry.quote.expiresAt.getTime() <= Date.now()) {
      this.quotes.delete(quoteId);
      throw new QuoteExpiredError(
        `Quote expired: ${quoteId}. Refresh the quote or basket and try again.`,
      );
    }
    if (Date.now() - entry.storedAt > QUOTE_TTL_MS + 5_000) {
      this.quotes.delete(quoteId);
      throw new QuoteExpiredError(
        `Quote expired: ${quoteId}. Refresh the quote or basket and try again.`,
      );
    }
    return entry;
  }

  /**
   * Swap in the quote that will actually execute (Titan re-quote or Jupiter
   * fallback) under the same id, keeping its original TTL and — crucially —
   * its original reviewed terms. A missing entry is not recreated: the
   * reviewed floor would be lost.
   */
  replace(quote: Quote): void {
    const entry = this.quotes.get(quote.id);
    if (entry) entry.quote = quote;
  }

  /** Soft get — returns null instead of throwing. */
  peek(quoteId: string): CachedQuoteEntry | null {
    try {
      return this.get(quoteId);
    } catch {
      return null;
    }
  }

  attachExecution(
    quoteId: string,
    executionId: string,
    wallet: string,
    transaction: string,
  ): void {
    const entry = this.quotes.get(quoteId);
    if (entry) {
      entry.executionId = executionId;
    }
    this.pendingByQuoteId.set(quoteId, {
      executionId,
      wallet,
      transaction,
      expiresAt: Date.now() + PENDING_EXECUTION_TTL_MS,
    });
  }

  getPendingExecution(quoteId: string): {
    executionId: string;
    wallet: string;
    transaction: string;
  } | null {
    const pending = this.pendingByQuoteId.get(quoteId);
    if (!pending) return null;
    if (pending.expiresAt <= Date.now()) {
      this.pendingByQuoteId.delete(quoteId);
      return null;
    }
    return {
      executionId: pending.executionId,
      wallet: pending.wallet,
      transaction: pending.transaction,
    };
  }

  delete(quoteId: string): void {
    this.quotes.delete(quoteId);
  }
}
