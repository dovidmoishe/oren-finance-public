import { secUserAgent, SecEdgarClient, SecFetchError } from './sec-client';

const USER_AGENT = secUserAgent('research@example.com');

const CIK = '0000320193';

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
  url = 'https://data.sec.gov/example.json',
) {
  return {
    status,
    url,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function client(options: {
  fetch: SecEdgarClient['loadCompany'] extends never
    ? never
    : ConstructorParameters<typeof SecEdgarClient>[0]['fetch'];
  now: { value: number };
  sleeps: number[];
  timeoutMs?: number;
  maxAttempts?: number;
  maxBytes?: number;
  factsTtlMs?: number;
  submissionsTtlMs?: number;
  staleGraceMs?: number;
  minIntervalMs?: number;
  maxEntries?: number;
}) {
  return new SecEdgarClient({
    userAgent: USER_AGENT,
    fetch: options.fetch,
    now: () => options.now.value,
    sleep: (ms) => {
      options.sleeps.push(ms);
      options.now.value += ms;
      return Promise.resolve();
    },
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    maxBytes: options.maxBytes,
    factsTtlMs: options.factsTtlMs ?? 1_000,
    submissionsTtlMs: options.submissionsTtlMs ?? 1_000,
    staleGraceMs: options.staleGraceMs ?? 5_000,
    minIntervalMs: options.minIntervalMs ?? 200,
    maxEntries: options.maxEntries,
  });
}

describe('SEC client bounds', () => {
  it('spaces requests at least 125ms and sends the declared user agent', async () => {
    const sleeps: number[] = [];
    const headers: Record<string, string>[] = [];
    const now = { value: 1_000 };
    const edgar = client({
      sleeps,
      now,
      minIntervalMs: 1,
      fetch: async (_url, init) => {
        await Promise.resolve();
        headers.push(init.headers);
        return response({ ok: true }, 200, {}, _url);
      },
    });
    await edgar.loadCompany(CIK);
    expect(sleeps).toEqual([125]);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(125);
    expect(headers[0]['User-Agent']).toBe(USER_AGENT);
    expect(headers.every((item) => item['User-Agent'] === USER_AGENT)).toBe(
      true,
    );
    expect(USER_AGENT).not.toContain('edgar-research@oren.finance');
  });

  it('retries a 429 at most three times and caps Retry-After at two seconds', async () => {
    const sleeps: number[] = [];
    const seen = new Map<string, number>();
    let calls = 0;
    const now = { value: 0 };
    const edgar = client({
      sleeps,
      now,
      fetch: async (url) => {
        await Promise.resolve();
        calls += 1;
        const attempt = (seen.get(url) ?? 0) + 1;
        seen.set(url, attempt);
        if (attempt === 1) {
          return response({ error: 'slow' }, 429, { 'retry-after': '9' }, url);
        }
        return response({ ok: true }, 200, {}, url);
      },
    });
    await expect(edgar.loadCompany(CIK)).resolves.toMatchObject({
      freshness: 'fresh',
    });
    expect(calls).toBe(4);
    expect(sleeps).toContain(2_000);
    expect(sleeps.some((ms) => ms > 2_000)).toBe(false);
  });

  it('stops after three failures and does not retry a 404 or a foreign host', async () => {
    const sleeps: number[] = [];
    let failures = 0;
    const now = { value: 0 };
    const failing = client({
      sleeps,
      now,
      maxAttempts: 9,
      fetch: async () => {
        await Promise.resolve();
        failures += 1;
        return response({ error: 'down' }, 503);
      },
    });
    await expect(failing.loadCompany(CIK)).rejects.toMatchObject({
      reason: 'provider_unavailable',
    });
    expect(failures).toBe(3);

    let missing = 0;
    const notFound = client({
      sleeps,
      now,
      fetch: async (url) => {
        await Promise.resolve();
        missing += 1;
        return response('missing', 404, {}, url);
      },
    });
    await expect(notFound.loadCompany(CIK)).rejects.toBeInstanceOf(
      SecFetchError,
    );
    expect(missing).toBe(1);

    let redirected = 0;
    const foreign = client({
      sleeps,
      now,
      fetch: async () => {
        await Promise.resolve();
        redirected += 1;
        return response(
          { secret: 'SUPERSECRET', val: 999 },
          200,
          {},
          'https://evil.example/facts',
        );
      },
    });
    await expect(foreign.loadCompany(CIK)).rejects.toMatchObject({
      reason: 'provider_unavailable',
      message: 'provider_unavailable',
    });
    expect(redirected).toBe(1);
  });

  it('times out and does not keep trying past the attempt cap', async () => {
    let calls = 0;
    const edgar = new SecEdgarClient({
      userAgent: USER_AGENT,
      timeoutMs: 15,
      maxAttempts: 9,
      minIntervalMs: 125,
      factsTtlMs: 1_000,
      submissionsTtlMs: 1_000,
      sleep: () => Promise.resolve(),
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          calls += 1;
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    });
    await expect(edgar.loadCompany(CIK)).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(calls).toBe(3);
  });

  it('deduplicates in-flight reads, serves a fresh cache, then falls back to stale', async () => {
    const sleeps: number[] = [];
    const now = { value: 0 };
    let calls = 0;
    let fail = false;
    const edgar = client({
      sleeps,
      now,
      fetch: async (url) => {
        await Promise.resolve();
        calls += 1;
        if (fail) throw new Error('network down');
        return response({ url }, 200, {}, url);
      },
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new SecEdgarClient({
      userAgent: USER_AGENT,
      now: () => now.value,
      sleep: async (ms) => {
        await Promise.resolve();
        sleeps.push(ms);
        now.value += ms;
      },
      factsTtlMs: 1_000,
      submissionsTtlMs: 1_000,
      staleGraceMs: 5_000,
      fetch: (url) =>
        gate.then(() => {
          calls += 1;
          return response({ url }, 200, {}, url);
        }),
    });
    const first = waiting.loadCompany(CIK);
    const second = waiting.loadCompany(CIK);
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left.facts).toEqual(right.facts);
    expect(calls).toBe(2);

    await edgar.loadCompany(CIK);
    const afterFresh = calls;
    await edgar.loadCompany(CIK);
    expect(calls).toBe(afterFresh);

    fail = true;
    now.value += 1_500;
    await expect(edgar.loadCompany(CIK)).resolves.toMatchObject({
      freshness: 'stale',
    });
    now.value += 10_000;
    await expect(edgar.loadCompany(CIK)).rejects.toMatchObject({
      reason: 'provider_unavailable',
    });
  });

  it('drops the oldest cache entries once the entry cap is reached', async () => {
    const sleeps: number[] = [];
    const now = { value: 0 };
    const seen: string[] = [];
    const edgar = client({
      sleeps,
      now,
      maxEntries: 2,
      factsTtlMs: 100_000,
      submissionsTtlMs: 100_000,
      fetch: async (url) => {
        await Promise.resolve();
        seen.push(url);
        return response({ url }, 200, {}, url);
      },
    });
    await edgar.loadCompany('0000000001');
    const first = [...seen];
    await edgar.loadCompany('0000000002');
    await edgar.loadCompany('0000000001');
    const again = seen.filter((url) => first.includes(url)).length;
    expect(again).toBeGreaterThan(first.length);
  });
});
