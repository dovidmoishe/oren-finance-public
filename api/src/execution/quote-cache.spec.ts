import { QuoteCache } from './quote-cache';
import type { Quote } from '../../types/quote';
import { QuoteExpiredError } from '../common/errors/provider.errors';

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  const now = new Date();
  return {
    id: 'quote-1',
    side: 'buy',
    assetId: 'aapl',
    ticker: 'AAPL',
    variant: {
      mint: 'mintA',
      symbol: 'xAAPL',
      name: 'AAPL',
      tradable: true,
    },
    inputMint: 'usdc',
    outputMint: 'mintA',
    inputSymbol: 'USDC',
    outputSymbol: 'xAAPL',
    inputAmount: 100,
    outputAmount: 1,
    estimatedPriceUsd: 100,
    amountUsd: 100,
    priceImpactPercent: 0.1,
    slippageBps: 50,
    provider: 'jupiter',
    routePayload: { inAmount: '1' },
    quotedAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
    ...overrides,
  };
}

describe('QuoteCache', () => {
  it('returns stored quotes before expiry', () => {
    const cache = new QuoteCache();
    const quote = makeQuote();
    cache.set(quote);
    expect(cache.get('quote-1').quote.id).toBe('quote-1');
  });

  it('rejects expired quotes', () => {
    const cache = new QuoteCache();
    const quote = makeQuote({
      expiresAt: new Date(Date.now() - 1_000),
    });
    cache.set(quote);
    expect(() => cache.get('quote-1')).toThrow(QuoteExpiredError);
  });

  it('tracks pending execution ids after prepare', () => {
    const cache = new QuoteCache();
    cache.set(makeQuote());
    cache.attachExecution('quote-1', 'exec-9', 'Wallet111', 'unsigned-tx');
    expect(cache.getPendingExecution('quote-1')).toEqual({
      executionId: 'exec-9',
      wallet: 'Wallet111',
      transaction: 'unsigned-tx',
    });
  });

  describe('reviewed terms (C3)', () => {
    const jup = (outAmount: string, otherAmountThreshold: string) =>
      makeQuote({
        routePayload: {
          inAmount: '100000000',
          outAmount,
          otherAmountThreshold,
          swapMode: 'ExactIn',
          slippageBps: 50,
        },
      });

    it('captures the reviewed minimum once, at first set', () => {
      const cache = new QuoteCache();
      cache.set(jup('400000000', '398000000'));
      expect(cache.get('quote-1').reviewed).toEqual({
        minOutRaw: '398000000',
        slippageBps: 50,
        provider: 'jupiter',
        outputAmount: 1,
      });
    });

    it('never lowers the reviewed minimum across replaces (R3 ratchet)', () => {
      const cache = new QuoteCache();
      cache.set(jup('400000000', '398000000'));
      // Successive prepares each accepted a slightly lower route…
      cache.replace(jup('398000000', '396010000'));
      cache.replace(jup('396010000', '394029950'));
      cache.set(jup('394029950', '392059800'));
      // …but the floor is still what the user first reviewed.
      expect(cache.get('quote-1').reviewed?.minOutRaw).toBe('398000000');
      expect(cache.get('quote-1').quote.routePayload).toMatchObject({
        otherAmountThreshold: '392059800',
      });
    });

    it('replace() does not recreate an evicted entry', () => {
      const cache = new QuoteCache();
      cache.replace(jup('400000000', '398000000'));
      expect(cache.peek('quote-1')).toBeNull();
    });
  });
});
