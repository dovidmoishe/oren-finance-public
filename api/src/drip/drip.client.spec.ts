import { DripClient } from './drip.client';

const API_KEY = 'pk_drip_test_secret';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('DripClient', () => {
  const fetchImpl = jest.fn();

  function client(apiKey: string | undefined = API_KEY) {
    return new DripClient({
      apiKey,
      baseUrl: 'https://dripstack.test',
      timeoutMs: 12_000,
      fetchImpl: fetchImpl as typeof fetch,
    });
  }

  beforeEach(() => {
    fetchImpl.mockReset();
  });

  it('calls the ticker route with a bearer key kept out of the URL', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, { meta: { ticker: 'NVDA' }, authors: [] }),
    );

    await expect(client().getTicker('NVDA')).resolves.toMatchObject({
      meta: { ticker: 'NVDA' },
    });

    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/api/v2/tickers/NVDA');
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.get('sort')).toBe('newest');
    expect(url.toString()).not.toContain(API_KEY);
    expect(init.headers).toMatchObject({
      accept: 'application/json',
      authorization: `Bearer ${API_KEY}`,
    });
  });

  it('calls the latest picks feed with prices omitted', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, { picks: [] }));

    await client().getLatestPicks();

    const url = (fetchImpl.mock.calls as Array<[URL]>)[0][0];
    expect(url.pathname).toBe('/api/v2/stock-picks');
    expect(url.searchParams.get('limitDays')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('15');
    expect(url.searchParams.get('sort')).toBe('newest');
    expect(url.searchParams.get('includePrices')).toBe('false');
    expect(url.toString()).not.toContain(API_KEY);
  });

  it('does not call Drip when the key is unset', async () => {
    await expect(client('').getTicker('NVDA')).rejects.toMatchObject({
      kind: 'unset',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps rate limits, auth failures, and malformed JSON without retrying', async () => {
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(429, { error: 'allowance', code: 'rate_limited' }),
    );
    await expect(client().getLatestPicks()).rejects.toMatchObject({
      kind: 'rate_limit',
      status: 429,
    });

    fetchImpl.mockResolvedValueOnce(jsonResponse(401, { error: 'nope' }));
    await expect(client().getTicker('NVDA')).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
    });

    fetchImpl.mockResolvedValueOnce(jsonResponse(403, { error: 'nope' }));
    await expect(client().getTicker('NVDA')).rejects.toMatchObject({
      kind: 'forbidden',
    });

    fetchImpl.mockResolvedValueOnce(jsonResponse(404, { error: 'none' }));
    await expect(client().getTicker('NVDA')).rejects.toMatchObject({
      kind: 'not_found',
    });

    fetchImpl.mockResolvedValueOnce(jsonResponse(500, { error: 'down' }));
    await expect(client().getTicker('NVDA')).rejects.toMatchObject({
      kind: 'http',
      status: 500,
    });

    fetchImpl.mockResolvedValueOnce(jsonResponse(200, 'not-json'));
    await expect(client().getTicker('NVDA')).rejects.toMatchObject({
      kind: 'malformed',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchImpl.mock.calls as Array<[URL, RequestInit]>) {
      expect(JSON.stringify(init.headers)).toContain(API_KEY);
      expect(JSON.stringify(init.headers)).not.toContain('not-json');
    }
  });

  it('aborts on timeout and keeps the key out of the error', async () => {
    jest.useFakeTimers();
    try {
      fetchImpl.mockImplementation((_url: URL, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });

      const pending = client()
        .getTicker('NVDA')
        .then(
          () => {
            throw new Error('resolved');
          },
          (error: unknown) => error,
        );
      await jest.advanceTimersByTimeAsync(12_000);
      const error = (await pending) as { kind: string; message: string };
      expect(error.kind).toBe('timeout');
      expect(error.message).not.toContain(API_KEY);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
