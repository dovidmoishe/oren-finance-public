import type { AppEnv } from '../../config/env.schema';
import { TitanClient } from './titan.client';
import { TitanError } from './titan.errors';
import { STOCK, titanResponse, USDC, WALLET } from '../../test/titan.fixtures';

const params = {
  inputMint: USDC,
  outputMint: STOCK,
  amount: '100000000',
  userPublicKey: WALLET,
  slippageBps: 50,
};

function setup(env: Partial<AppEnv> = {}) {
  let t = 1_800_000_000_000;
  const fetchImpl = jest.fn();
  const client = new TitanClient(
    {
      TITAN_API_KEY: 'titan-test-key',
      TITAN_API_URL: 'https://titan.test/',
      TITAN_MAX_RPS: 1,
      ...env,
    } as AppEnv,
    {
      now: () => t,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    },
  );
  return {
    client,
    fetchImpl,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof TitanError ? err.titanCode : String(err);
  }
}

describe('TitanClient', () => {
  it('requests JSON quotes with explicit slippage, without ALT contents by default', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(json(titanResponse()));

    const res = await client.quoteSwap(params);

    expect(res.metadata?.ExpectedWinner).toBe('Titan-DART');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://titan.test/api/v1/quote/swap',
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      inputMint: USDC,
      outputMint: STOCK,
      amount: '100000000',
      userPublicKey: WALLET,
      slippageBps: '50',
      maxPriceDeviationBps: '100',
    });
    expect(init.headers).toEqual({
      'x-api-key': 'titan-test-key',
      Accept: 'application/json',
    });
  });

  it('is disabled without an API key and never calls the network', async () => {
    const { client, fetchImpl } = setup({ TITAN_API_KEY: undefined });
    expect(client.enabled).toBe(false);
    expect(await codeOf(client.quoteSwap(params))).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips (does not wait) when the rate budget is spent', async () => {
    const { client, fetchImpl } = setup({ TITAN_MAX_RPS: 1 / 60 });
    fetchImpl.mockResolvedValue(json(titanResponse()));
    await client.quoteSwap(params, 'priority');
    expect(await codeOf(client.quoteSwap(params, 'priority'))).toBe(
      'skipped_rate_budget',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends TITAN_MAX_PRICE_DEVIATION_BPS when configured', async () => {
    const { client, fetchImpl } = setup({ TITAN_MAX_PRICE_DEVIATION_BPS: 250 });
    fetchImpl.mockResolvedValue(json(titanResponse()));
    await client.quoteSwap(params);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('maxPriceDeviationBps')).toBe('250');
  });

  it('asks for ALT contents only when requested', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(json(titanResponse()));
    await client.quoteSwap({ ...params, includeAltContents: true });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('includeAltContents')).toBe('true');
  });

  it('reserves a third of the budget for prepare-time (priority) re-quotes', async () => {
    // 3 per minute → 1 reserved for priority, 2 for background quotes.
    const { client, fetchImpl } = setup({ TITAN_MAX_RPS: 3 / 60 });
    fetchImpl.mockImplementation(() => Promise.resolve(json(titanResponse())));
    expect(await codeOf(client.quoteSwap(params))).toBe('resolved');
    expect(await codeOf(client.quoteSwap(params))).toBe('resolved');
    // Shadow / auto-refresh traffic cannot take the last slot...
    expect(await codeOf(client.quoteSwap(params))).toBe('skipped_rate_budget');
    // ...which stays available for the user's prepare re-quote.
    expect(await codeOf(client.quoteSwap(params, 'priority'))).toBe('resolved');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('trips the breaker on 403 (edge / path / plan problems)', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(json({ message: 'Forbidden' }, 403));
    expect(await codeOf(client.quoteSwap(params))).toBe('forbidden');
    expect(client.breaker.openReason).toBe('forbidden');
    expect(await codeOf(client.quoteSwap(params))).toBe('breaker_open');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('opens the breaker for retry-after on rate_limited', async () => {
    const { client, fetchImpl, advance } = setup();
    fetchImpl.mockResolvedValueOnce(
      json({ error: { code: 'rate_limited' } }, 429, { 'retry-after': '12' }),
    );
    expect(await codeOf(client.quoteSwap(params))).toBe('rate_limited');
    expect(await codeOf(client.quoteSwap(params))).toBe('breaker_open');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    advance(12_000);
    fetchImpl.mockResolvedValueOnce(json(titanResponse()));
    expect(await codeOf(client.quoteSwap(params))).toBe('resolved');
  });

  it('distinguishes allowance_exhausted and stops for much longer', async () => {
    const { client, fetchImpl, advance } = setup();
    fetchImpl.mockResolvedValueOnce(
      json({ error: { code: 'allowance_exhausted' } }, 429, {
        'retry-after': '1',
      }),
    );
    expect(await codeOf(client.quoteSwap(params))).toBe('allowance_exhausted');
    advance(5 * 60_000);
    expect(await codeOf(client.quoteSwap(params))).toBe('breaker_open');
    expect(client.breaker.openReason).toBe('allowance_exhausted');
  });

  it('pauses on invalid_api_key', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(
      json({ error: { code: 'invalid_api_key' } }, 401),
    );
    expect(await codeOf(client.quoteSwap(params))).toBe('invalid_api_key');
    expect(await codeOf(client.quoteSwap(params))).toBe('breaker_open');
  });

  it('maps 404 code -7 to no_route without tripping the breaker', async () => {
    const { client, fetchImpl } = setup({ TITAN_MAX_RPS: 10 });
    fetchImpl.mockImplementation(() =>
      Promise.resolve(json({ code: -7, message: 'No acceptable routes' }, 404)),
    );
    for (let i = 0; i < 4; i++) {
      expect(await codeOf(client.quoteSwap(params))).toBe('no_route');
    }
    expect(client.breaker.isOpen()).toBe(false);
  });

  it('times out and opens the breaker after repeated failures', async () => {
    const { client, fetchImpl } = setup({ TITAN_MAX_RPS: 10 });
    const timeout = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    });
    fetchImpl.mockRejectedValue(timeout);
    expect(await codeOf(client.quoteSwap(params))).toBe('timeout');
    expect(await codeOf(client.quoteSwap(params))).toBe('timeout');
    expect(await codeOf(client.quoteSwap(params))).toBe('timeout');
    expect(await codeOf(client.quoteSwap(params))).toBe('breaker_open');
  });

  it('rejects bodies without quotes', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(json({ id: 'x' }));
    expect(await codeOf(client.quoteSwap(params))).toBe('invalid_response');
  });
});
