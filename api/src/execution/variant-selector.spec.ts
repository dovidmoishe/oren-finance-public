import { VariantSelector } from './variant-selector';
import type { Equity } from '../../types/equity';

describe('VariantSelector.pickCandidates', () => {
  const selector = new VariantSelector({} as never, {} as never);

  const equity: Equity = {
    id: 'aapl',
    ticker: 'AAPL',
    name: 'Apple',
    category: 'equity',
    variants: [
      {
        mint: 'mintLow',
        symbol: 'a',
        name: 'a',
        liquidity: 10,
        tradable: true,
      },
      {
        mint: 'mintHigh',
        symbol: 'b',
        name: 'b',
        liquidity: 100,
        tradable: true,
      },
      {
        mint: 'mintDead',
        symbol: 'c',
        name: 'c',
        liquidity: 999,
        tradable: false,
      },
    ],
  };

  it('skips non-tradable variants', () => {
    const picked = selector.pickCandidates(equity);
    expect(picked.every((v) => v.tradable)).toBe(true);
    expect(picked.map((v) => v.mint)).not.toContain('mintDead');
  });

  it('ranks by liquidity descending', () => {
    const picked = selector.pickCandidates(equity);
    expect(picked[0].mint).toBe('mintHigh');
    expect(picked[1].mint).toBe('mintLow');
  });

  it('honors preferredMint when tradable', () => {
    const picked = selector.pickCandidates(equity, 'mintLow');
    expect(picked).toHaveLength(1);
    expect(picked[0].mint).toBe('mintLow');
  });

  it('ignores preferredMint when not tradable', () => {
    const picked = selector.pickCandidates(equity, 'mintDead');
    expect(picked.map((v) => v.mint)).toEqual(['mintHigh', 'mintLow']);
  });

  it('fails closed when an exact prepared mint is no longer tradable', () => {
    expect(selector.pickCandidates(equity, 'mintDead', true)).toEqual([]);
    expect(selector.pickCandidates(equity, 'missingMint', true)).toEqual([]);
  });
});

describe('VariantSelector.selectAndQuote routing', () => {
  const variants = ['m1', 'm2', 'm3'].map((mint, i) => ({
    mint,
    symbol: mint,
    name: mint,
    decimals: 8,
    liquidity: 100 - i,
    tradable: true,
  }));
  const equity: Equity = {
    id: 'tsla',
    ticker: 'TSLA',
    name: 'Tesla',
    category: 'equity',
    variants,
  };

  it('passes the wallet through and only offers the top variants to Titan', async () => {
    const tokens = { getStock: jest.fn().mockResolvedValue(equity) };
    const router = {
      quote: jest.fn((ctx: { variant: { mint: string } }) =>
        Promise.resolve({
          id: ctx.variant.mint,
          outputAmount: ctx.variant.mint === 'm3' ? 3 : 1,
          priceImpactPercent: 0,
        }),
      ),
    };
    const selector = new VariantSelector(tokens as never, router as never);

    const result = await selector.selectAndQuote({
      side: 'buy',
      assetId: 'tsla',
      ticker: 'TSLA',
      amountUsd: 50,
      wallet: 'wallet-1',
    });

    expect(result.quote.id).toBe('m3');
    const calls = router.quote.mock.calls.map(
      ([c]) =>
        c as unknown as {
          variant: { mint: string };
          wallet?: string;
          titanEligible?: boolean;
        },
    );
    const byMint = Object.fromEntries(calls.map((c) => [c.variant.mint, c]));
    expect(byMint.m1).toMatchObject({
      wallet: 'wallet-1',
      titanEligible: true,
    });
    expect(byMint.m2).toMatchObject({
      wallet: 'wallet-1',
      titanEligible: true,
    });
    expect(byMint.m3).toMatchObject({
      wallet: 'wallet-1',
      titanEligible: false,
    });
  });

  it('skips Titan on every variant when the trade must be signed in chat', async () => {
    const tokens = { getStock: jest.fn().mockResolvedValue(equity) };
    const router = {
      quote: jest.fn().mockResolvedValue({
        id: 'q',
        outputAmount: 1,
        priceImpactPercent: 0,
        provider: 'jupiter',
      }),
    };
    const selector = new VariantSelector(tokens as never, router as never);
    await selector.selectAndQuote({
      side: 'buy',
      assetId: 'tsla',
      ticker: 'TSLA',
      amountUsd: 50,
      wallet: 'wallet-1',
      jupiterOnly: true,
    });
    const calls = router.quote.mock.calls.map(
      ([c]) => c as { titanEligible?: boolean; slippageBps?: number },
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.titanEligible === false)).toBe(true);
  });

  it('sends auto-refresh quotes on the background rate lane', async () => {
    const tokens = { getStock: jest.fn().mockResolvedValue(equity) };
    const router = {
      quote: jest.fn().mockResolvedValue({
        id: 'q',
        outputAmount: 1,
        priceImpactPercent: 0,
      }),
    };
    const selector = new VariantSelector(tokens as never, router as never);
    const intent = {
      side: 'buy' as const,
      assetId: 'tsla',
      ticker: 'TSLA',
      amountUsd: 50,
    };
    await selector.selectAndQuote(intent);
    expect(router.quote).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'priority' }),
    );
    router.quote.mockClear();
    await selector.selectAndQuote({ ...intent, autoRefresh: true });
    expect(router.quote).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'background' }),
    );
    expect(router.quote).not.toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'priority' }),
    );
  });

  it('reports venue-neutral no-route errors', async () => {
    const tokens = { getStock: jest.fn().mockResolvedValue(equity) };
    const router = { quote: jest.fn().mockRejectedValue(new Error('x')) };
    const selector = new VariantSelector(tokens as never, router as never);
    await expect(
      selector.selectAndQuote({
        side: 'buy',
        assetId: 'tsla',
        ticker: 'TSLA',
        amountUsd: 50,
      }),
    ).rejects.toThrow('No swap routes for TSLA');
  });
});
