export function secUserAgent(email: string): string {
  return `Oren Finance (${email})`;
}

/** At most 8 requests/second. The SEC fair-access cap is 10. */
const MIN_SPACING_MS = 125;
const MAX_ATTEMPTS = 3;
const MAX_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 20_000_000;
const BACKOFF_MS = [200, 600];
const MAX_BACKOFF_MS = 2_000;

export class SecFetchError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    readonly reason:
      | 'timeout'
      | 'rate_limited'
      | 'provider_unavailable'
      | 'sec_not_configured'
      | 'sec_preview_disabled'
      | 'sec_worker_unavailable',
    options?: { retryable?: boolean; retryAfterMs?: number },
  ) {
    super(reason);
    this.name = 'SecFetchError';
    this.retryable = options?.retryable ?? true;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export interface SecHttpResponse {
  status: number;
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface SecCompanySnapshot {
  facts: unknown;
  submissions: unknown;
  fetchedAt: string;
  freshness: 'fresh' | 'stale';
}

interface CachedDoc {
  body: unknown;
  fetchedAt: string;
  freshness: 'fresh' | 'stale';
}

export class SecEdgarClient {
  private readonly fetchImpl: (
    url: string,
    init: { signal: AbortSignal; headers: Record<string, string> },
  ) => Promise<SecHttpResponse>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly maxBytes: number;
  private readonly factsTtlMs: number;
  private readonly submissionsTtlMs: number;
  private readonly staleGraceMs: number;
  private readonly maxEntries: number;
  private readonly maxCacheBytes: number;
  private readonly userAgent: string;
  private readonly admit?: () => Promise<boolean> | boolean;
  private halted = false;
  private readonly active = new Set<AbortController>();
  private lastStart = Number.NEGATIVE_INFINITY;
  private tail: Promise<void> = Promise.resolve();
  private readonly cache = new Map<
    string,
    { body: unknown; storedAt: number; fetchedAt: string; ttlMs: number }
  >();
  private readonly inflight = new Map<string, Promise<CachedDoc>>();

  constructor(options: {
    fetch: SecEdgarClient['fetchImpl'];
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    minIntervalMs?: number;
    timeoutMs?: number;
    maxAttempts?: number;
    maxBytes?: number;
    factsTtlMs?: number;
    submissionsTtlMs?: number;
    staleGraceMs?: number;
    maxEntries?: number;
    maxCacheBytes?: number;
    userAgent: string;
    /** Return false to refuse a fetch. Checked again for every queued attempt. */
    admit?: () => Promise<boolean> | boolean;
  }) {
    this.fetchImpl = options.fetch;
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minIntervalMs = Math.max(MIN_SPACING_MS, options.minIntervalMs ?? 200);
    this.timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1, options.timeoutMs ?? 8_000),
    );
    this.maxAttempts = Math.min(
      MAX_ATTEMPTS,
      Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS),
    );
    this.maxBytes = Math.min(
      MAX_BODY_BYTES,
      Math.max(1, options.maxBytes ?? MAX_BODY_BYTES),
    );
    this.factsTtlMs = options.factsTtlMs ?? 6 * 60 * 60 * 1000;
    this.submissionsTtlMs = options.submissionsTtlMs ?? 60 * 60 * 1000;
    this.staleGraceMs = options.staleGraceMs ?? 7 * 24 * 60 * 60 * 1000;
    this.maxEntries = Math.min(64, Math.max(2, options.maxEntries ?? 32));
    this.maxCacheBytes = Math.min(
      40_000_000,
      Math.max(1, options.maxCacheBytes ?? 40_000_000),
    );
    if (!options.userAgent.trim()) {
      throw new Error('SEC user agent is required');
    }
    this.userAgent = options.userAgent;
    this.admit = options.admit;
  }

  /** Stop queued and in-flight EDGAR calls. Does not open another connection. */
  halt(): void {
    this.halted = true;
    for (const controller of this.active) controller.abort();
  }

  async loadCompany(cik: string): Promise<SecCompanySnapshot> {
    if (!/^\d{10}$/.test(cik)) {
      throw new SecFetchError('provider_unavailable', { retryable: false });
    }
    const submissions = await this.loadUrl(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      this.submissionsTtlMs,
    );
    const facts = await this.loadUrl(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      this.factsTtlMs,
    );
    return {
      facts: facts.body,
      submissions: submissions.body,
      fetchedAt:
        submissions.fetchedAt > facts.fetchedAt
          ? submissions.fetchedAt
          : facts.fetchedAt,
      freshness:
        submissions.freshness === 'stale' || facts.freshness === 'stale'
          ? 'stale'
          : 'fresh',
    };
  }

  private loadUrl(url: string, ttlMs: number): Promise<CachedDoc> {
    const pending = this.inflight.get(url);
    if (pending) return pending;
    const created = this.loadUrlOnce(url, ttlMs).finally(() => {
      this.inflight.delete(url);
    });
    this.inflight.set(url, created);
    return created;
  }

  private async loadUrlOnce(url: string, ttlMs: number): Promise<CachedDoc> {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.storedAt < hit.ttlMs) {
      return { body: hit.body, fetchedAt: hit.fetchedAt, freshness: 'fresh' };
    }
    try {
      const body = await this.request(url);
      const fetchedAt = new Date(this.now()).toISOString();
      this.remember(url, body, fetchedAt, ttlMs);
      return { body, fetchedAt, freshness: 'fresh' };
    } catch (error) {
      if (hit && this.now() - hit.storedAt < hit.ttlMs + this.staleGraceMs) {
        return { body: hit.body, fetchedAt: hit.fetchedAt, freshness: 'stale' };
      }
      throw error;
    }
  }

  private async request(url: string): Promise<unknown> {
    let lastError = new SecFetchError('provider_unavailable');
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.pace();
      await this.admitOrThrow();
      try {
        const response = await this.withTimeout((signal) =>
          this.fetchImpl(url, {
            signal,
            headers: {
              Accept: 'application/json',
              'User-Agent': this.userAgent,
            },
          }),
        );
        if (response.url && !response.url.startsWith('https://data.sec.gov/')) {
          throw new SecFetchError('provider_unavailable', { retryable: false });
        }
        if (response.status === 429) {
          throw new SecFetchError('rate_limited', {
            retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
          });
        }
        if (response.status !== 200) {
          throw new SecFetchError('provider_unavailable', {
            retryable: response.status >= 500,
          });
        }
        const text = await response.text();
        if (text.length > this.maxBytes) {
          throw new SecFetchError('provider_unavailable', { retryable: false });
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new SecFetchError('provider_unavailable');
        }
      } catch (error) {
        lastError =
          error instanceof SecFetchError
            ? error
            : new SecFetchError(
                this.halted
                  ? 'sec_worker_unavailable'
                  : isAbort(error)
                    ? 'timeout'
                    : 'provider_unavailable',
                this.halted ? { retryable: false } : undefined,
              );
        if (!lastError.retryable || attempt === this.maxAttempts)
          throw lastError;
        const backoff = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)!;
        const wait = Math.min(
          MAX_BACKOFF_MS,
          Math.max(backoff, lastError.retryAfterMs ?? 0),
        );
        await this.sleep(wait);
      }
    }
    throw lastError;
  }

  private pace(): Promise<void> {
    const run = this.tail.then(async () => {
      if (this.lastStart !== Number.NEGATIVE_INFINITY) {
        const wait = this.lastStart + this.minIntervalMs - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastStart = this.now();
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async admitOrThrow(): Promise<void> {
    if (this.halted || (this.admit && !(await this.admit()))) {
      this.halt();
      throw new SecFetchError('sec_worker_unavailable', { retryable: false });
    }
  }

  private async withTimeout<T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    this.active.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SecFetchError('timeout'));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([work(controller.signal), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      this.active.delete(controller);
    }
  }

  private remember(
    url: string,
    body: unknown,
    fetchedAt: string,
    ttlMs: number,
  ): void {
    this.cache.set(url, { body, storedAt: this.now(), fetchedAt, ttlMs });
    const entries = [...this.cache.entries()].sort(
      (a, b) => a[1].storedAt - b[1].storedAt,
    );
    let total = entries.reduce(
      (sum, [, entry]) => sum + JSON.stringify(entry.body).length,
      0,
    );
    for (const [key] of entries) {
      if (this.cache.size <= this.maxEntries && total <= this.maxCacheBytes) {
        break;
      }
      if (key === url && this.cache.size === 1) break;
      const removed = this.cache.get(key);
      this.cache.delete(key);
      if (removed) total -= JSON.stringify(removed.body).length;
    }
  }
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export function createLiveSecClient(
  userAgent: string,
  admit?: () => Promise<boolean> | boolean,
  fetchImpl?: SecEdgarClient['fetchImpl'],
): SecEdgarClient {
  return new SecEdgarClient({
    userAgent,
    admit,
    fetch:
      fetchImpl ??
      (async (url, init) => {
        const response = await fetch(url, {
          headers: init.headers,
          signal: init.signal,
          redirect: 'manual',
        });
        return {
          status: response.status,
          url: response.url,
          headers: response.headers,
          text: () => response.text(),
        };
      }),
  });
}
