import type { Quote } from '../../types/quote';
import {
  PriceMovedError,
  QuoteExpiredError,
} from '../common/errors/provider.errors';
import type { AppEnv, SwapRouterMode } from '../config/env.schema';
import { STOCK, USDC, WALLET } from '../test/titan.fixtures';
import {
  buildComparisonRow,
  compareOut,
  estimateNetworkFeeLamports,
  meetsReviewed,
  minimumOut,
  netEdgeBps,
  type RouterQuoteContext,
  SwapRouter,
  TITAN_REQUOTE_AFTER_MS,
} from './swap-router';
import type { FeeSnapshot } from './swap-fee-oracle';
import { reviewedTermsFor } from './swap-terms';
import { TitanError } from './titan/titan.errors';
import type { TitanRoutePayload } from './titan/titan.types';

const NOW = 1_800_000_000_000;
/** Live-fee inputs as the SwapFeeOracle would return them. */
const LIVE_FEES: FeeSnapshot = { solUsd: 250, priorityMicroLamports: 10_000 };

const ctx: RouterQuoteContext = {
  side: 'buy',
  assetId: 'tsla',
  ticker: 'TSLA',
  variant: { mint: STOCK, symbol: 'TSLAx', name: 'T', tradable: true },
  inputMint: USDC,
  outputMint: STOCK,
  inputSymbol: 'USDC',
  outputSymbol: 'TSLAx',
  inputDecimals: 6,
  outputDecimals: 8,
  amountUi: 100,
  amountUsd: 100,
  slippageBps: 50,
  wallet: WALLET,
};

function baseQuote(over: Partial<Quote>): Quote {
  return {
    id: 'q',
    side: 'buy',
    assetId: 'tsla',
    ticker: 'TSLA',
    variant: ctx.variant,
    inputMint: USDC,
    outputMint: STOCK,
    inputSymbol: 'USDC',
    outputSymbol: 'TSLAx',
    inputAmount: 100,
    outputAmount: 4,
    estimatedPriceUsd: 25,
    amountUsd: 100,
    priceImpactPercent: 0,
    slippageBps: 50,
    provider: 'jupiter',
    quotedAt: new Date(NOW),
    expiresAt: new Date(NOW + 30_000),
    ...over,
  };
}

function jupiterQuote(outAmount: string, id = 'jup'): Quote {
  return baseQuote({
    id,
    outputAmount: Number(outAmount) / 1e8,
    routePayload: { inAmount: '100000000', outAmount, slippageBps: 50 },
  });
}

function titanQuote(
  outAmount: string,
  over: Partial<TitanRoutePayload> = {},
  id = 'tit',
): Quote {
  const payload: TitanRoutePayload = {
    kind: 'titan',
    quoteId: 'swap:1',
    providerId: 'Titan-DART',
    route: {
      inAmount: 100_000_000,
      outAmount: Number(outAmount),
      slippageBps: over.route?.slippageBps ?? 50,
      instructions: [],
      computeUnitsSafe: 300_000,
    },
    alts: [],
    wallet: WALLET,
    quotedAtMs: NOW,
    inAmountRaw: '100000000',
    outAmountRaw: outAmount,
    amountRaw: '100000000',
    inputDecimals: 6,
    outputDecimals: 8,
    requestedSlippageBps: 50,
    ...over,
  };
  return baseQuote({
    id,
    outputAmount: Number(outAmount) / 1e8,
    provider: 'titan:Titan-DART',
    slippageBps: payload.route.slippageBps,
    routePayload: payload,
  });
}

function setup(mode: SwapRouterMode, titanEnabled = true) {
  const jupiter = {
    getQuoteWithContext: jest.fn(),
    validateQuote: jest.fn().mockResolvedValue(true),
    prepareSwap: jest.fn((quote: Quote, wallet: string) =>
      Promise.resolve({
        quoteId: quote.id,
        wallet,
        transaction: 'jup-tx',
        provider: 'jupiter',
        expiresAt: quote.expiresAt,
      }),
    ),
  };
  const titan = {
    enabled: titanEnabled,
    getQuoteWithContext: jest.fn(),
    requote: jest.fn(),
    prepareSwap: jest.fn((quote: Quote, wallet: string) =>
      Promise.resolve({
        quoteId: quote.id,
        wallet,
        transaction: 'titan-tx',
        provider: quote.provider,
        expiresAt: quote.expiresAt,
      }),
    ),
  };
  const fees = {
    snapshot: jest
      .fn<Promise<FeeSnapshot | undefined>, []>()
      .mockResolvedValue(LIVE_FEES),
  };
  const router = new SwapRouter(
    jupiter as never,
    titan as never,
    {
      SWAP_ROUTER_MODE: mode,
    } as AppEnv,
    fees as never,
  );
  let t = NOW;
  router.now = () => t;
  const logs: string[] = [];
  jest
    .spyOn(
      (router as unknown as { logger: { log: (m: string) => void } }).logger,
      'log',
    )
    .mockImplementation((m: string) => {
      logs.push(m);
    });
  return {
    router,
    jupiter,
    titan,
    fees,
    logs,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SwapRouter.quote', () => {
  it('jupiter mode never calls Titan', async () => {
    const { router, jupiter, titan } = setup('jupiter');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    await expect(router.quote(ctx)).resolves.toMatchObject({ id: 'jup' });
    expect(titan.getQuoteWithContext).not.toHaveBeenCalled();
  });

  it('kill switch: no TITAN_API_KEY forces jupiter even in best mode', async () => {
    const { router, jupiter, titan } = setup('best', false);
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    expect(router.mode).toBe('jupiter');
    await router.quote(ctx);
    expect(titan.getQuoteWithContext).not.toHaveBeenCalled();
  });

  it('shadow mode returns Jupiter and logs the comparison', async () => {
    const { router, jupiter, titan, logs } = setup('shadow');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('402000000'));

    const quote = await router.quote(ctx);
    await flush();

    expect(quote.provider).toBe('jupiter');
    expect(titan.getQuoteWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: WALLET, slippageBps: 50 }),
    );
    const row = JSON.parse(logs[0]) as Record<string, unknown>;
    expect(row).toMatchObject({
      event: 'swap_quote_comparison',
      mode: 'shadow',
      ticker: 'TSLA',
      amountRaw: '100000000',
      slippageBps: 50,
      jupiterOutAmount: '400000000',
      titanOutAmount: '402000000',
      titanWinner: 'Titan-DART',
      deltaBps: 50,
      selected: 'jupiter',
    });
  });

  it('shadow mode still fails when Jupiter fails (behaviour unchanged)', async () => {
    const { router, jupiter, titan } = setup('shadow');
    jupiter.getQuoteWithContext.mockRejectedValue(new Error('no route'));
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('402000000'));
    await expect(router.quote(ctx)).rejects.toThrow('no route');
  });

  it('best mode picks Titan when it pays more and keeps the Jupiter fallback', async () => {
    const { router, jupiter, titan } = setup('best');
    const jup = jupiterQuote('400000000');
    jupiter.getQuoteWithContext.mockResolvedValue(jup);
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('402000000'));

    const quote = await router.quote(ctx);
    expect(quote.provider).toBe('titan:Titan-DART');
    expect((quote.routePayload as TitanRoutePayload).jupiterFallback).toBe(jup);
  });

  it('best mode keeps Jupiter on ties or when Jupiter pays more', async () => {
    const { router, jupiter, titan } = setup('best');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('402000000'));
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('402000000'));
    await expect(router.quote(ctx)).resolves.toMatchObject({
      provider: 'jupiter',
    });
  });

  it.each([
    ['timeout', new TitanError('timeout', 't')],
    ['rate_limited', new TitanError('rate_limited', 'r')],
    ['breaker_open', new TitanError('breaker_open', 'b')],
    ['unexpected', new Error('boom')],
  ])('best mode falls back to Jupiter on Titan %s', async (code, error) => {
    const { router, jupiter, titan, logs } = setup('best');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockRejectedValue(error);
    await expect(router.quote(ctx)).resolves.toMatchObject({
      provider: 'jupiter',
    });
    const row = JSON.parse(logs[0]) as Record<string, unknown>;
    expect(row.titanErrorCode).toBe(code === 'unexpected' ? 'unknown' : code);
    expect(row.selected).toBe('jupiter');
  });

  it('best mode without a wallet skips Titan entirely', async () => {
    const { router, jupiter, titan, logs } = setup('best');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    await router.quote({ ...ctx, wallet: undefined });
    expect(titan.getQuoteWithContext).not.toHaveBeenCalled();
    expect(JSON.parse(logs[0])).toMatchObject({
      titanErrorCode: 'no_wallet',
      hasWallet: false,
    });
  });

  it('skips Titan for variants outside the top ranks', async () => {
    const { router, jupiter, titan } = setup('best');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    await router.quote({ ...ctx, titanEligible: false });
    expect(titan.getQuoteWithContext).not.toHaveBeenCalled();
  });

  it('best mode uses Titan when Jupiter has no route', async () => {
    const { router, jupiter, titan } = setup('best');
    jupiter.getQuoteWithContext.mockRejectedValue(new Error('no route'));
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('402000000'));
    const quote = await router.quote(ctx);
    expect(quote.provider).toBe('titan:Titan-DART');
    expect(
      (quote.routePayload as TitanRoutePayload).jupiterFallback,
    ).toBeUndefined();
  });

  it('refreshes Titan with a new lifetime after Jupiter times out', async () => {
    const { router, jupiter, titan, advance } = setup('best');
    const stale = titanQuote('402000000');
    const fresh = titanQuote('401000000', { quotedAtMs: NOW + 30_001 });
    fresh.expiresAt = new Date(NOW + 60_001);
    jupiter.getQuoteWithContext.mockImplementation(() => {
      advance(30_001);
      return Promise.reject(new Error('Jupiter timed out'));
    });
    titan.getQuoteWithContext
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);

    await expect(router.quote(ctx)).resolves.toBe(fresh);
    expect(titan.getQuoteWithContext).toHaveBeenCalledTimes(2);
    expect(titan.requote).not.toHaveBeenCalled();
    expect(fresh.expiresAt.getTime()).toBeGreaterThan(router.now());
  });

  it('compares the refreshed Titan price when Jupiter was slow', async () => {
    const { router, jupiter, titan, advance } = setup('best');
    const jup = jupiterQuote('400000000');
    const fresh = titanQuote('399000000', { quotedAtMs: NOW + 6_000 });
    jupiter.getQuoteWithContext.mockImplementation(() => {
      advance(6_000);
      return Promise.resolve(jup);
    });
    titan.getQuoteWithContext
      .mockResolvedValueOnce(titanQuote('402000000'))
      .mockResolvedValueOnce(fresh);

    await expect(router.quote(ctx)).resolves.toBe(jup);
    expect(titan.getQuoteWithContext).toHaveBeenCalledTimes(2);
  });

  it('keeps Jupiter if refreshing an old Titan route exhausts its budget', async () => {
    const { router, jupiter, titan, advance } = setup('best');
    const jup = jupiterQuote('400000000');
    jupiter.getQuoteWithContext.mockImplementation(() => {
      advance(6_000);
      return Promise.resolve(jup);
    });
    titan.getQuoteWithContext
      .mockResolvedValueOnce(titanQuote('402000000'))
      .mockRejectedValueOnce(new TitanError('skipped_rate_budget', 'spent'));

    await expect(router.quote(ctx)).resolves.toBe(jup);
  });

  it('never returns an expired Titan route when its refresh is also stale', async () => {
    const { router, jupiter, titan, advance } = setup('best');
    const failure = new Error('Jupiter timed out');
    jupiter.getQuoteWithContext.mockImplementation(() => {
      advance(30_001);
      return Promise.reject(failure);
    });
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('402000000'));

    await expect(router.quote(ctx)).rejects.toBe(failure);
    expect(titan.getQuoteWithContext).toHaveBeenCalledTimes(2);
  });

  it('refreshes a provider hard expiry even before the local route age limit', async () => {
    const { router, jupiter, titan } = setup('best');
    const stale = titanQuote('402000000');
    (stale.routePayload as TitanRoutePayload).route.expiresAtMs = NOW + 500;
    const fresh = titanQuote('401000000');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);

    await expect(router.quote(ctx)).resolves.toBe(fresh);
    expect(titan.getQuoteWithContext).toHaveBeenCalledTimes(2);
  });
});

describe('SwapRouter.prepare', () => {
  // Titan quoted 402,000,000 at 50 bps ⇒ reviewed minimum 399,990,000.
  const REVIEWED_MIN = 399_990_000n;

  it('prepares Jupiter quotes through Jupiter', async () => {
    const { router, jupiter, titan } = setup('best');
    const quote = jupiterQuote('400000000', 'q');
    const result = await router.prepare(quote, WALLET);
    expect(result.prepared.transaction).toBe('jup-tx');
    expect(result.quote).toBe(quote);
    expect(result.expectation).toEqual({
      inputMint: USDC,
      outputMint: STOCK,
      maxInRaw: '100000000',
      minOutRaw: '398000000',
    });
    expect(jupiter.validateQuote).toHaveBeenCalledWith(quote);
    expect(titan.prepareSwap).not.toHaveBeenCalled();
  });

  it('refuses a Jupiter quote that no longer meets the reviewed minimum', async () => {
    const { router, jupiter } = setup('best');
    const reviewed = reviewedTermsFor(jupiterQuote('400000000', 'q'))!;
    await expect(
      router.prepare(jupiterQuote('399000000', 'q'), WALLET, reviewed),
    ).rejects.toBeInstanceOf(PriceMovedError);
    expect(jupiter.prepareSwap).not.toHaveBeenCalled();
  });

  it('builds a fresh Titan route without re-quoting', async () => {
    const { router, titan } = setup('best');
    const quote = titanQuote('402000000', {}, 'q');
    const result = await router.prepare(quote, WALLET);
    expect(titan.requote).not.toHaveBeenCalled();
    expect(result.prepared.transaction).toBe('titan-tx');
    expect(result.quote).toBe(quote);
    expect(result.expectation?.minOutRaw).toBe(REVIEWED_MIN.toString());
  });

  describe('C1: re-quotes are judged by their own on-chain minimum', () => {
    it('accepts a re-quote whose enforced minimum equals the reviewed minimum', async () => {
      const { router, titan, advance } = setup('best');
      const quote = titanQuote('402000000', {}, 'q');
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      const fresh = titanQuote('402000000', {}, 'q');
      titan.requote.mockResolvedValue(fresh);

      const result = await router.prepare(quote, WALLET);
      expect(titan.requote).toHaveBeenCalledWith(quote, WALLET);
      expect(result.quote).toBe(fresh);
      expect(result.prepared.transaction).toBe('titan-tx');
    });

    it('refuses a re-quote whose expected out clears the floor but whose on-chain minimum does not (R1)', async () => {
      const { router, titan, jupiter, advance } = setup('best');
      const quote = titanQuote('400000000', {}, 'q'); // reviewed min 398,000,000
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      // out 398,000,000 ≥ old floor, but enforces only 396,010,000 on-chain.
      titan.requote.mockResolvedValue(titanQuote('398000000', {}, 'q'));
      await expect(router.prepare(quote, WALLET)).rejects.toBeInstanceOf(
        PriceMovedError,
      );
      expect(titan.prepareSwap).not.toHaveBeenCalled();
      expect(jupiter.prepareSwap).not.toHaveBeenCalled();
    });

    it('refuses a re-quote one raw unit below the boundary', async () => {
      const { router, titan, advance } = setup('best');
      const quote = titanQuote('402000000', {}, 'q');
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      titan.requote.mockResolvedValue(titanQuote('401999999', {}, 'q'));
      await expect(router.prepare(quote, WALLET)).rejects.toBeInstanceOf(
        PriceMovedError,
      );
    });

    it('refuses a re-quote with more slippage than the user requested', async () => {
      const { router, titan, advance } = setup('best');
      const quote = titanQuote('402000000', {}, 'q');
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      // Huge out, so the minimum clears — but slippage 80 > requested 50.
      titan.requote.mockResolvedValue(
        titanQuote(
          '500000000',
          {
            route: {
              inAmount: 100_000_000,
              outAmount: 500_000_000,
              slippageBps: 80,
              instructions: [],
            },
          },
          'q',
        ),
      );
      await expect(router.prepare(quote, WALLET)).rejects.toBeInstanceOf(
        PriceMovedError,
      );
    });

    it('a route that used less slippage than requested may re-quote up to the requested slippage', async () => {
      const { router, titan, advance } = setup('best');
      const route = (slippageBps: number, out: number) => ({
        route: {
          inAmount: 100_000_000,
          outAmount: out,
          slippageBps,
          instructions: [],
        },
      });
      // Reviewed: 30 bps on 402,000,000 ⇒ min 400,794,000.
      const quote = titanQuote('402000000', route(30, 402_000_000), 'q');
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      // 50 bps (≤ requested 50) on 403,000,000 ⇒ min 400,985,000 ≥ floor.
      const fresh = titanQuote('403000000', route(50, 403_000_000), 'q');
      titan.requote.mockResolvedValue(fresh);
      await expect(router.prepare(quote, WALLET)).resolves.toMatchObject({
        quote: fresh,
      });
    });
  });

  it('re-quotes when the provider hard expiry has passed', async () => {
    const { router, titan } = setup('best');
    const quote = titanQuote('402000000', {}, 'q');
    (quote.routePayload as TitanRoutePayload).route.expiresAtMs = NOW;
    titan.requote.mockResolvedValue(titanQuote('402000000', {}, 'q'));
    await router.prepare(quote, WALLET);
    expect(titan.requote).toHaveBeenCalled();
  });

  it('re-quotes when preparing for a different wallet than quoted', async () => {
    const { router, titan } = setup('best');
    const quote = titanQuote('402000000', { wallet: USDC }, 'q');
    titan.requote.mockResolvedValue(titanQuote('402000000', {}, 'q'));
    await router.prepare(quote, WALLET);
    expect(titan.requote).toHaveBeenCalledWith(quote, WALLET);
  });

  it('re-quotes once when the build reports a slot-expired route', async () => {
    const { router, titan } = setup('best');
    const quote = titanQuote('402000000', {}, 'q');
    const fresh = titanQuote('402000000', {}, 'q');
    titan.prepareSwap.mockRejectedValueOnce(new TitanError('stale_quote', 's'));
    titan.requote.mockResolvedValue(fresh);
    const result = await router.prepare(quote, WALLET);
    expect(titan.requote).toHaveBeenCalledTimes(1);
    expect(result.quote).toBe(fresh);
  });

  describe('C2: the Jupiter fallback is held to the same floor', () => {
    it('uses the fallback when it meets the reviewed minimum', async () => {
      const { router, jupiter, titan, advance, logs } = setup('best');
      // Jupiter enforces exactly the reviewed 399,990,000.
      const jup = jupiterQuote('402000000', 'jup-original');
      const quote = titanQuote('402000000', { jupiterFallback: jup }, 'q');
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      titan.requote.mockRejectedValue(new TitanError('rate_limited', 'r'));

      const result = await router.prepare(quote, WALLET);
      expect(titan.prepareSwap).not.toHaveBeenCalled();
      expect(result.prepared.transaction).toBe('jup-tx');
      // Same quote id so the cache/approval mapping stays intact.
      expect(result.quote.id).toBe('q');
      expect(result.quote.provider).toBe('jupiter');
      expect(result.expectation?.minOutRaw).toBe(REVIEWED_MIN.toString());
      expect(jupiter.prepareSwap).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q', routePayload: jup.routePayload }),
        WALLET,
      );
      expect(
        logs.map((l) => JSON.parse(l) as Record<string, unknown>),
      ).toContainEqual(
        expect.objectContaining({
          event: 'swap_prepare_route',
          executedProvider: 'jupiter',
          fallbackReason: 'requote_failed:rate_limited',
        }),
      );
    });

    it('refuses a worse Jupiter fallback with PRICE_MOVED (R2)', async () => {
      const { router, jupiter, titan, advance } = setup('best');
      const jup = jupiterQuote('200000000'); // 50% worse
      const quote = titanQuote('402000000', { jupiterFallback: jup }, 'q');
      advance(TITAN_REQUOTE_AFTER_MS + 1);
      titan.requote.mockResolvedValue(titanQuote('300000000', {}, 'q'));
      const err = await router.prepare(quote, WALLET).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PriceMovedError);
      expect(err).toMatchObject({ statusCode: 409, code: 'PRICE_MOVED' });
      expect(jupiter.prepareSwap).not.toHaveBeenCalled();
    });

    it('refuses a worse fallback after a build failure too', async () => {
      const { router, titan, jupiter } = setup('best');
      titan.prepareSwap.mockRejectedValue(
        new TitanError('tx_build_failed', 'x'),
      );
      const quote = titanQuote(
        '402000000',
        { jupiterFallback: jupiterQuote('400000000') },
        'q',
      );
      await expect(router.prepare(quote, WALLET)).rejects.toBeInstanceOf(
        PriceMovedError,
      );
      expect(jupiter.prepareSwap).not.toHaveBeenCalled();
    });
  });

  it('C3: judges every prepare against the originally reviewed terms', async () => {
    const { router, titan, advance } = setup('best');
    const original = titanQuote('402000000', {}, 'q');
    const reviewed = reviewedTermsFor(original)!;
    // A previous prepare cached a lower (but then-acceptable) route…
    const lowered = titanQuote('398000000', {}, 'q');
    advance(TITAN_REQUOTE_AFTER_MS + 1);
    titan.requote.mockResolvedValue(titanQuote('398000000', {}, 'q'));
    // …the next prepare still uses the first reviewed minimum.
    await expect(
      router.prepare(lowered, WALLET, reviewed),
    ).rejects.toBeInstanceOf(PriceMovedError);
  });

  it('asks for a fresh quote when Titan is stale and no Jupiter fallback exists', async () => {
    const { router, titan, advance } = setup('best');
    const quote = titanQuote('402000000', {}, 'q');
    advance(TITAN_REQUOTE_AFTER_MS + 1);
    titan.requote.mockRejectedValue(new TitanError('no_route', 'n'));
    await expect(router.prepare(quote, WALLET)).rejects.toBeInstanceOf(
      QuoteExpiredError,
    );
  });
});

describe('best mode is net of the live network fee', () => {
  const heavyTitan = (out: string) => {
    const quote = titanQuote(out);
    (quote.routePayload as TitanRoutePayload).route.computeUnitsSafe =
      1_400_000;
    return quote;
  };

  it('estimates more fee for a heavier Titan route at the live priority price', () => {
    const light = titanQuote('1', {});
    expect(estimateNetworkFeeLamports(heavyTitan('1'), 10_000)).toBe(19_000);
    expect(estimateNetworkFeeLamports(light, 10_000)).toBe(8_000);
    expect(estimateNetworkFeeLamports(light, 20_000)).toBe(11_000);
  });

  it('a tiny gross edge on a small trade loses to the extra fee', async () => {
    const { router, jupiter, titan, logs } = setup('best');
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockResolvedValue(heavyTitan('400200000')); // +5 bps
    // $5 trade: 11,000 extra lamports × $250/SOL ≈ $0.00275 ≈ 5.5 bps.
    const quote = await router.quote({ ...ctx, amountUsd: 5 });
    expect(quote.provider).toBe('jupiter');
    const row = JSON.parse(logs[0]) as Record<string, unknown>;
    expect(row).toMatchObject({
      deltaBps: 5,
      feeBasis: 'live',
      solUsd: 250,
      priorityMicroLamports: 10_000,
    });
    expect(row.netDeltaBps as number).toBeLessThan(1);
  });

  it('uses the live SOL price: the same edge wins when SOL is cheaper', async () => {
    const { router, jupiter, titan, fees } = setup('best');
    fees.snapshot.mockResolvedValue({ ...LIVE_FEES, solUsd: 100 });
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockResolvedValue(heavyTitan('400200000'));
    // 11,000 lamports × $100 = $0.0011 on $5 = 2.2 bps < 5 bps gross.
    const quote = await router.quote({ ...ctx, amountUsd: 5 });
    expect(quote.provider).toBe('titan:Titan-DART');
  });

  it('keeps that Titan win for browser quotes and selects Jupiter for in-chat signing', async () => {
    const { router, jupiter, titan, fees } = setup('best');
    fees.snapshot.mockResolvedValue({ ...LIVE_FEES, solUsd: 100 });
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockResolvedValue(heavyTitan('400200000'));
    const browser = await router.quote({ ...ctx, amountUsd: 5 });
    expect(browser.provider).toBe('titan:Titan-DART');
    expect(titan.getQuoteWithContext).toHaveBeenCalled();

    titan.getQuoteWithContext.mockClear();
    const chat = await router.quote({
      ...ctx,
      amountUsd: 5,
      titanEligible: false,
    });
    expect(chat.provider).toBe('jupiter');
    expect(titan.getQuoteWithContext).not.toHaveBeenCalled();

    const retry = await router.quote({
      ...ctx,
      amountUsd: 5,
      slippageBps: 50,
      titanEligible: false,
    });
    expect(retry.provider).toBe('jupiter');
    expect(titan.getQuoteWithContext).not.toHaveBeenCalled();
    expect(jupiter.getQuoteWithContext).toHaveBeenLastCalledWith(
      expect.objectContaining({ slippageBps: 50, titanEligible: false }),
    );
  });

  it('fails safe to Jupiter when live fee inputs are unavailable', async () => {
    const { router, jupiter, titan, fees, logs } = setup('best');
    fees.snapshot.mockResolvedValue(undefined);
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('420000000')); // +500 bps
    const quote = await router.quote(ctx);
    expect(quote.provider).toBe('jupiter');
    expect(JSON.parse(logs[0])).toMatchObject({
      feeBasis: 'unavailable',
      selected: 'jupiter',
    });
  });

  it('fails safe when the fee oracle throws', async () => {
    const { router, jupiter, titan, fees } = setup('best');
    fees.snapshot.mockRejectedValue(new Error('boom'));
    jupiter.getQuoteWithContext.mockResolvedValue(jupiterQuote('400000000'));
    titan.getQuoteWithContext.mockResolvedValue(titanQuote('420000000'));
    await expect(router.quote(ctx)).resolves.toMatchObject({
      provider: 'jupiter',
    });
  });

  it('the same edge wins on a large trade', () => {
    expect(
      netEdgeBps(
        heavyTitan('400200000'),
        jupiterQuote('400000000'),
        10_000,
        LIVE_FEES,
      ),
    ).toBeGreaterThan(4.9);
  });
});

describe('PRICE_MOVED offers a Jupiter alternative', () => {
  it('returns old vs new terms and a fresh Jupiter quote, without executing it', async () => {
    const { router, jupiter, titan, advance } = setup('best');
    const quote = titanQuote('402000000', {}, 'q');
    advance(TITAN_REQUOTE_AFTER_MS + 1);
    titan.requote.mockResolvedValue(titanQuote('398000000', {}, 'q'));
    const alternative = {
      ...jupiterQuote('399000000', 'jup-alt'),
      routePayload: {
        inAmount: '100000000',
        outAmount: '399000000',
        otherAmountThreshold: '397005000',
        swapMode: 'ExactIn',
        slippageBps: 50,
      },
    };
    jupiter.getQuoteWithContext.mockResolvedValue(alternative);

    const err = (await router
      .prepare(quote, WALLET)
      .catch((e: unknown) => e)) as PriceMovedError;

    expect(err).toBeInstanceOf(PriceMovedError);
    // Same trade: raw input, mints, requested slippage.
    expect(jupiter.getQuoteWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        inputMint: USDC,
        outputMint: STOCK,
        amountUi: 100,
        inputDecimals: 6,
        outputDecimals: 8,
        slippageBps: 50,
      }),
    );
    expect(err.details).toMatchObject({
      quoteId: 'q',
      reviewed: {
        minOutRaw: '399990000',
        minimumOutputAmount: 3.9999,
        outputAmount: 4.02,
        slippageBps: 50,
      },
      latest: { provider: 'titan:Titan-DART', minOutRaw: '396010000' },
      alternative: {
        id: 'jup-alt',
        provider: 'jupiter',
        minOutRaw: '397005000',
        minimumOutputAmount: 3.97005,
      },
    });
    // The client never sees route payloads; the cache gets the full quote.
    expect(err.details?.alternative).not.toHaveProperty('routePayload');
    expect(err.alternativeQuote).toBe(alternative);
    // Nothing was built or executed.
    expect(jupiter.prepareSwap).not.toHaveBeenCalled();
    expect(titan.prepareSwap).not.toHaveBeenCalled();
  });

  it('still returns PRICE_MOVED when no Jupiter alternative is available', async () => {
    const { router, jupiter, titan, advance } = setup('best');
    const quote = titanQuote('402000000', {}, 'q');
    advance(TITAN_REQUOTE_AFTER_MS + 1);
    titan.requote.mockResolvedValue(titanQuote('398000000', {}, 'q'));
    jupiter.getQuoteWithContext.mockRejectedValue(new Error('rate limited'));
    const err = (await router
      .prepare(quote, WALLET)
      .catch((e: unknown) => e)) as PriceMovedError;
    expect(err).toBeInstanceOf(PriceMovedError);
    expect(err.details?.alternative).toBeUndefined();
    expect(err.alternativeQuote).toBeUndefined();
  });
});

describe('swap-router helpers', () => {
  it('minimumOut floors outAmount × (1 − slippage)', () => {
    expect(minimumOut('402000000', 50)).toBe(399990000n);
    expect(minimumOut('3', 50)).toBe(2n);
  });

  it('compareOut normalises by inAmount', () => {
    const a = jupiterQuote('200');
    const b = titanQuote('100', { inAmountRaw: '50000000' });
    // b: 100 out for half the input ⇒ equal rate to a(200 for 100000000).
    expect(compareOut(a, b)).toBe(0);
  });

  it('meetsReviewed requires both the minimum and the slippage', () => {
    const reviewed = { minOutRaw: '398000000', slippageBps: 50, provider: 'x' };
    expect(meetsReviewed(jupiterQuote('400000000'), reviewed)).toBe(true);
    expect(meetsReviewed(jupiterQuote('399999999'), reviewed)).toBe(false);
    expect(
      meetsReviewed(
        { ...jupiterQuote('500000000'), slippageBps: 51 },
        reviewed,
      ),
    ).toBe(false);
  });

  it('builds comparison rows with delta bps', () => {
    const row = buildComparisonRow(
      'shadow',
      ctx,
      { ok: true, value: jupiterQuote('1000000'), latencyMs: 120 },
      { ok: true, value: titanQuote('998500'), latencyMs: 340 },
      'jupiter',
    );
    expect(row).toMatchObject({
      jupiterLatencyMs: 120,
      titanLatencyMs: 340,
      deltaBps: -15,
    });
  });
});
