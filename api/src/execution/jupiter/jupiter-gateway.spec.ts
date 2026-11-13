import { JupiterRateLimitedError } from '../../common/errors/provider.errors';
import type { AppEnv } from '../../config/env.schema';
import { isJupiterHost, JupiterGateway } from './jupiter-gateway';

function setup(env: Partial<AppEnv>, responses: Response[]) {
  let t = 1_800_000_000_000;
  const now = () => t;
  const sleep = jest.fn((ms: number) => {
    t += ms;
    return Promise.resolve();
  });
  const fetchImpl = jest.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch');
      return Promise.resolve(next);
    },
  );
  const gateway = new JupiterGateway({ JUPITER_MAX_RPS: 1, ...env } as AppEnv, {
    now,
    sleep,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { gateway, fetchImpl, sleep, now: () => t };
}

function headerOf(call: unknown[], name: string): string | null {
  return new Headers((call[1] as RequestInit).headers).get(name);
}

describe('JupiterGateway', () => {
  it('sends x-api-key when JUPITER_API_KEY is set', async () => {
    const { gateway, fetchImpl } = setup({ JUPITER_API_KEY: 'test-key' }, [
      new Response('{}', { status: 200 }),
    ]);
    await gateway.fetch(
      'https://api.jup.ag/swap/v1/quote',
      { method: 'GET', headers: { Accept: 'application/json' } },
      'Jupiter',
    );
    expect(headerOf(fetchImpl.mock.calls[0], 'x-api-key')).toBe('test-key');
    expect(headerOf(fetchImpl.mock.calls[0], 'accept')).toBe(
      'application/json',
    );
  });

  it('stays keyless when no key is configured', async () => {
    const { gateway, fetchImpl } = setup({}, [
      new Response('{}', { status: 200 }),
    ]);
    await gateway.fetch('https://api.jup.ag/swap/v1/quote', {}, 'Jupiter');
    expect(headerOf(fetchImpl.mock.calls[0], 'x-api-key')).toBeNull();
    expect(gateway.hasApiKey).toBe(false);
  });

  it('honours x-ratelimit-reset on 429 and retries', async () => {
    const { gateway, fetchImpl, sleep, now } = setup({}, []);
    const resetAt = Math.floor(now() / 1000) + 2;
    fetchImpl
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
          headers: { 'x-ratelimit-reset': String(resetAt) },
        }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const res = await gateway.fetch('https://api.jup.ag/x', {}, 'Jupiter');
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('backs off exponentially without hints, then gives up', async () => {
    const { gateway, fetchImpl, sleep } = setup({ JUPITER_MAX_RPS: 10 }, [
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
    ]);
    await expect(
      gateway.fetch('https://api.jup.ag/x', {}, 'Jupiter'),
    ).rejects.toBeInstanceOf(JupiterRateLimitedError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1_000, 2_000]);
  });

  it('fails fast when the local budget cannot free up in time', async () => {
    const { gateway, fetchImpl } = setup({ JUPITER_MAX_RPS: 1 / 60 }, [
      new Response('{}', { status: 200 }),
    ]);
    await gateway.fetch('https://api.jup.ag/x', {}, 'Jupiter');
    await expect(
      gateway.fetch('https://api.jup.ag/x', {}, 'Jupiter'),
    ).rejects.toBeInstanceOf(JupiterRateLimitedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never sends the key to a non-Jupiter host', async () => {
    const { gateway, fetchImpl } = setup({ JUPITER_API_KEY: 'test-key' }, [
      new Response('{}', { status: 200 }),
    ]);
    await gateway.fetch('https://proxy.example/swap/v1/quote', {}, 'Jupiter');
    expect(headerOf(fetchImpl.mock.calls[0], 'x-api-key')).toBeNull();
    expect(isJupiterHost('https://api.jup.ag/swap/v1')).toBe(true);
    expect(isJupiterHost('https://evil-jup.ag.example')).toBe(false);
  });

  it('keeps reserved budget for user requests when the poller is busy', async () => {
    // 0.5 rps keyless → 30/min, half reserved for priority traffic.
    const responses = Array.from(
      { length: 31 },
      () => new Response('{}', { status: 200 }),
    );
    const { gateway, fetchImpl } = setup({ JUPITER_MAX_RPS: 0.5 }, responses);
    for (let i = 0; i < 15; i++) {
      await gateway.fetch('https://api.jup.ag/t', {}, 'poll', 'background');
    }
    // The 16th background call would have to wait ~60s → fails fast.
    await expect(
      gateway.fetch('https://api.jup.ag/t', {}, 'poll', 'background'),
    ).rejects.toBeInstanceOf(JupiterRateLimitedError);
    // User traffic still gets its 15 reserved slots immediately.
    for (let i = 0; i < 15; i++) {
      await gateway.fetch('https://api.jup.ag/q', {}, 'Jupiter');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(30);
  });
});
