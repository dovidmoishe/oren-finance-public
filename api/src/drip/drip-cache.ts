interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

/**
 * Per-process memory cache. Same shape as the Bitget context cache: a hit
 * skips the provider, and concurrent misses share one request.
 */
export class TtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.read<T>(key, ttlMs);
    if (cached) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        this.entries.set(key, { value, storedAt: this.now() });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  private read<T>(key: string, ttlMs: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt >= ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }
}
