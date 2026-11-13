import type { AppEnv } from '../../config/env.schema';
import { CompanyResearchService } from './company-research.service';
import { SecWorkerSession, type SecLockConnection } from './sec-access';
import { secUserAgent, SecEdgarClient } from './sec-client';

const apple = {
  id: 'apple',
  ticker: 'AAPL',
  name: 'Apple',
  category: 'equity' as const,
  variants: [
    {
      mint: 'AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8',
      symbol: 'AAPL',
      name: 'Apple - Backpack Securities',
      tradable: true,
    },
  ],
};

const production = {
  DEPLOYMENT_ENV: 'production',
  SEC_CONTACT_EMAIL: 'filings@example.com',
  POSTGRES_URL: 'postgres://oren@localhost/oren',
} as AppEnv;

function exclusiveLock() {
  let holder: { pid: number; drop: () => void } | undefined;
  let opens = 0;
  return {
    opens: () => opens,
    kill: () => holder?.drop(),
    open(): Promise<SecLockConnection | undefined> {
      opens += 1;
      if (holder) return Promise.resolve(undefined);
      let notify: () => void = () => undefined;
      let alive = true;
      const pid = opens;
      const drop = () => {
        if (!alive) return;
        alive = false;
        if (holder?.pid === pid) holder = undefined;
        notify();
      };
      holder = { pid, drop };
      return Promise.resolve({
        pid,
        queryPid: () =>
          alive
            ? Promise.resolve(pid)
            : Promise.reject(new Error('session closed')),
        onLost: (listener) => {
          notify = listener;
        },
        unlockAndClose: () => {
          drop();
          return Promise.resolve();
        },
        shutdown: () => {
          drop();
          return Promise.resolve();
        },
      });
    },
  };
}

function http(calls: string[]) {
  return (url: string) => {
    calls.push(url);
    const body = url.includes('submissions')
      ? {
          cik: '0000320193',
          name: 'Apple Inc.',
          tickers: ['AAPL'],
          fiscalYearEnd: '0926',
          filings: {
            recent: { accessionNumber: [], filingDate: [], form: [] },
          },
        }
      : { cik: 320193, entityName: 'Apple Inc.', facts: { 'us-gaap': {} } };
    return Promise.resolve({
      status: 200,
      url,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  };
}

describe('SEC worker lock lifetime', () => {
  it('lets one live session fetch and denies the other without a second hold', async () => {
    const gate = exclusiveLock();
    const calls: string[] = [];
    const fetch = http(calls);
    const first = new CompanyResearchService(
      production,
      () => gate.open(),
      fetch,
    );
    const second = new CompanyResearchService(
      production,
      () => gate.open(),
      fetch,
    );
    const owned = await first.load(apple);
    expect(owned.available).toBe(true);
    const denied = await second.load(apple);
    expect(denied).toMatchObject({
      available: false,
      reason: 'sec_worker_unavailable',
    });
    expect(calls.length).toBe(2);
    expect(gate.opens()).toBe(2);

    gate.kill();
    const afterLoss = await first.load(apple);
    expect(afterLoss.reason).toBe('sec_worker_unavailable');
    expect(calls.length).toBe(2);
    expect(gate.opens()).toBe(2);

    const replacement = await second.load(apple);
    expect(replacement.available).toBe(true);
    expect(calls.length).toBe(4);
    expect(gate.opens()).toBe(3);
    const stuck = await first.load(apple);
    expect(stuck.reason).toBe('sec_worker_unavailable');
    expect(calls.length).toBe(4);
    expect(gate.opens()).toBe(3);
  });

  it('releases the lock on cleanup and does not reconnect the closed process', async () => {
    const gate = exclusiveLock();
    const calls: string[] = [];
    const first = new CompanyResearchService(
      production,
      () => gate.open(),
      http(calls),
    );
    const second = new CompanyResearchService(
      production,
      () => gate.open(),
      http(calls),
    );
    await first.load(apple);
    await first.onModuleDestroy();
    const next = await second.load(apple);
    expect(next.available).toBe(true);
    const retired = await first.load(apple);
    expect(retired.reason).toBe('sec_worker_unavailable');
    expect(gate.opens()).toBe(2);
  });

  it('does not open a database session for a preview or a missing contact', async () => {
    let opens = 0;
    const open = () => {
      opens += 1;
      return Promise.resolve(undefined);
    };
    const preview = new CompanyResearchService(
      {
        ...production,
        DEPLOYMENT_ENV: 'preview',
        PREVIEW_PR_NUMBER: 4,
        COMMIT_SHA: 'a'.repeat(40),
      },
      open,
      () => Promise.reject(new Error('fetch')),
    );
    const unconfigured = new CompanyResearchService(
      { ...production, SEC_CONTACT_EMAIL: undefined },
      open,
      () => Promise.reject(new Error('fetch')),
    );
    expect((await preview.load(apple)).reason).toBe('sec_preview_disabled');
    expect((await unconfigured.load(apple)).reason).toBe('sec_not_configured');
    expect(opens).toBe(0);
  });

  it('stops a queued fetch when the session dies and does not fetch on a new pid', async () => {
    let releaseSleep: () => void = () => undefined;
    let fetches = 0;
    const pid = 4;
    let notify: () => void = () => undefined;
    const connection: SecLockConnection = {
      pid: 4,
      queryPid: () => Promise.resolve(pid),
      onLost: (listener) => {
        notify = listener;
      },
      unlockAndClose: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const session = await SecWorkerSession.acquire(() =>
      Promise.resolve(connection),
    );
    if (!session) throw new Error('lock');
    const client = new SecEdgarClient({
      userAgent: secUserAgent('filings@example.com'),
      admit: () => session.admit(),
      minIntervalMs: 125,
      timeoutMs: 5_000,
      sleep: () =>
        new Promise((resolve) => {
          releaseSleep = resolve;
        }),
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          fetches += 1;
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    });
    session.onLost(() => client.halt());
    const first = client.loadCompany('0000320193');
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetches).toBe(1);
    const second = client.loadCompany('0000320193');
    notify();
    releaseSleep();
    await Promise.allSettled([first, second]);
    expect(fetches).toBe(1);
    expect(session.isHeld()).toBe(false);
  });

  it('treats a replaced backend pid as lock loss and does not fetch', async () => {
    let pid = 4;
    let shutdowns = 0;
    const session = await SecWorkerSession.acquire(() =>
      Promise.resolve({
        pid: 4,
        queryPid: () => Promise.resolve(pid),
        onLost: () => undefined,
        unlockAndClose: () => Promise.resolve(),
        shutdown: () => {
          shutdowns += 1;
          return Promise.resolve();
        },
      }),
    );
    if (!session) throw new Error('lock');
    expect(await session.admit()).toBe(true);
    pid = 9;
    let fetches = 0;
    const client = new SecEdgarClient({
      userAgent: secUserAgent('filings@example.com'),
      admit: () => session.admit(),
      fetch: () => {
        fetches += 1;
        return Promise.reject(new Error('must not fetch'));
      },
    });
    await expect(client.loadCompany('0000320193')).rejects.toMatchObject({
      reason: 'sec_worker_unavailable',
    });
    expect(fetches).toBe(0);
    expect(session.isHeld()).toBe(false);
    expect(shutdowns).toBe(1);
    expect(await session.admit()).toBe(false);
  });
});
