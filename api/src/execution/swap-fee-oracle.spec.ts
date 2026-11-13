import {
  FEE_ORACLE_TTL_MS,
  jupiterPriceUrl,
  SwapFeeOracle,
} from './swap-fee-oracle';
import { NATIVE_SOL_MINT } from './swap-balance-guard';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(opts: { timeoutMs?: number } = {}) {
  let t = 1_800_000_000_000;
  const gateway = {
    fetch: jest.fn(() =>
      Promise.resolve(json({ [NATIVE_SOL_MINT]: { usdPrice: 187.25 } })),
    ),
  };
  const rpc = {
    call: jest.fn(() =>
      Promise.resolve(
        [0, 0, 5_000, 20_000].map((prioritizationFee, slot) => ({
          slot,
          prioritizationFee,
        })),
      ),
    ),
  };
  const oracle = new SwapFeeOracle(
    gateway as never,
    rpc as never,
    { JUPITER_API_URL: 'https://api.jup.ag/swap/v1' },
    { now: () => t, timeoutMs: opts.timeoutMs ?? 1_500 },
  );
  jest
    .spyOn(
      (oracle as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);
  return {
    oracle,
    gateway,
    rpc,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('SwapFeeOracle', () => {
  it('reads the live SOL price from Jupiter Price v3 on the background lane', async () => {
    const { oracle, gateway } = setup();
    await expect(oracle.snapshot()).resolves.toEqual({
      solUsd: 187.25,
      priorityMicroLamports: 5_000,
    });
    expect(gateway.fetch).toHaveBeenCalledWith(
      `https://api.jup.ag/price/v3?ids=${NATIVE_SOL_MINT}`,
      expect.objectContaining({ method: 'GET' }),
      'Jupiter price',
      'background',
    );
  });

  it('caches both inputs for the TTL, then refreshes', async () => {
    const { oracle, gateway, rpc, advance } = setup();
    await oracle.snapshot();
    advance(FEE_ORACLE_TTL_MS - 1);
    await oracle.snapshot();
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    advance(2);
    gateway.fetch.mockResolvedValueOnce(
      json({ [NATIVE_SOL_MINT]: { usdPrice: 190 } }),
    );
    await expect(oracle.solUsd()).resolves.toBe(190);
    expect(gateway.fetch).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent fetches', async () => {
    const { oracle, gateway } = setup();
    await Promise.all([oracle.solUsd(), oracle.solUsd(), oracle.snapshot()]);
    expect(gateway.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an HTTP error', () => Promise.resolve(json({}, 500))],
    ['a missing SOL entry', () => Promise.resolve(json({}))],
    [
      'an implausible price',
      () => Promise.resolve(json({ [NATIVE_SOL_MINT]: { usdPrice: 0 } })),
    ],
    [
      'the local Jupiter budget being spent',
      () => Promise.reject(new Error('rate limited')),
    ],
  ])('is unavailable (never a constant) on %s', async (_label, impl) => {
    const { oracle, gateway } = setup();
    gateway.fetch.mockImplementation(impl);
    await expect(oracle.solUsd()).resolves.toBeUndefined();
    await expect(oracle.snapshot()).resolves.toBeUndefined();
  });

  it('is unavailable when the priority-fee RPC fails', async () => {
    const { oracle, rpc } = setup();
    rpc.call.mockRejectedValue(new Error('rpc down'));
    await expect(oracle.snapshot()).resolves.toBeUndefined();
  });

  it('never waits longer than the timeout, but still fills the cache', async () => {
    jest.useFakeTimers();
    try {
      const { oracle, gateway } = setup({ timeoutMs: 100 });
      let release!: (r: Response) => void;
      gateway.fetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );
      const pending = oracle.solUsd();
      jest.advanceTimersByTime(100);
      await expect(pending).resolves.toBeUndefined();
      release(json({ [NATIVE_SOL_MINT]: { usdPrice: 150 } }));
      await Promise.resolve();
      await new Promise(
        jest.requireActual<typeof import('timers')>('timers').setImmediate,
      );
      await expect(oracle.solUsd()).resolves.toBe(150);
    } finally {
      jest.useRealTimers();
    }
  });

  it('derives the price URL from JUPITER_API_URL', () => {
    expect(jupiterPriceUrl('https://api.jup.ag/swap/v1')).toBe(
      'https://api.jup.ag/price/v3',
    );
    expect(jupiterPriceUrl('not a url')).toBe('https://api.jup.ag/price/v3');
  });
});
