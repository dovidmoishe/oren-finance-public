/**
 * In-process request budgeting for third-party APIs.
 *
 * Jupiter (and Titan) enforce a rolling 60-second window of `rps × 60`
 * requests per organisation, so the limiter mirrors that with a sliding
 * window: it allows the same short bursts the upstream allows and never
 * more than the window.
 *
 * Two lanes share one window:
 * - `priority`: user-facing work (quotes a user is waiting on, swap builds).
 *   May use the whole window.
 * - `background`: pollers, auto-refreshes, shadow traffic. May only use the
 *   window up to `limit − reserved`, so a slice is always left for priority.
 *
 * Limits are per API process. Multiple API replicas sharing one key must
 * split the budget (set *_MAX_RPS accordingly).
 */

export type Clock = () => number;
export type RateLane = 'priority' | 'background';

export const RATE_WINDOW_MS = 60_000;

export interface RateLimiterOptions {
  /**
   * Fraction of the window (0–1) that background callers can never use.
   * Default 0 = no reservation.
   */
  reservedForPriority?: number;
}

export class SlidingWindowRateLimiter {
  private readonly stamps: number[] = [];
  private pausedUntil = 0;
  readonly limit: number;
  /** Slots background callers cannot take. */
  readonly reserved: number;

  constructor(
    maxRps: number,
    private readonly now: Clock = Date.now,
    readonly windowMs: number = RATE_WINDOW_MS,
    options: RateLimiterOptions = {},
  ) {
    if (!Number.isFinite(maxRps) || maxRps <= 0) {
      throw new Error(`maxRps must be > 0, got ${maxRps}`);
    }
    this.limit = Math.max(1, Math.floor((maxRps * windowMs) / 1000));
    const fraction = Math.min(1, Math.max(0, options.reservedForPriority ?? 0));
    // Background always keeps at least one slot unless fully reserved.
    this.reserved =
      fraction === 0
        ? 0
        : Math.min(this.limit, Math.max(1, Math.ceil(this.limit * fraction)));
  }

  private capacity(lane: RateLane): number {
    return lane === 'priority' ? this.limit : this.limit - this.reserved;
  }

  /** Take a slot now if one is free. Never waits. */
  tryAcquire(lane: RateLane = 'priority'): boolean {
    const now = this.now();
    if (now < this.pausedUntil) return false;
    this.prune(now);
    if (this.stamps.length >= this.capacity(lane)) return false;
    this.stamps.push(now);
    return true;
  }

  /** Milliseconds until `tryAcquire(lane)` can succeed (0 = now). */
  msUntilAvailable(lane: RateLane = 'priority'): number {
    const now = this.now();
    this.prune(now);
    const pauseWait = Math.max(0, this.pausedUntil - now);
    const capacity = this.capacity(lane);
    if (capacity <= 0) return Number.POSITIVE_INFINITY;
    const windowWait =
      this.stamps.length < capacity
        ? 0
        : Math.max(
            0,
            this.stamps[this.stamps.length - capacity] + this.windowMs - now,
          );
    return Math.max(pauseWait, windowWait);
  }

  /**
   * Wait for a slot, up to `maxWaitMs`. Returns false when the budget would
   * not free up in time (callers should fail fast rather than pile up).
   */
  async acquire(
    maxWaitMs: number,
    sleep: (ms: number) => Promise<void> = defaultSleep,
    lane: RateLane = 'priority',
  ): Promise<boolean> {
    const deadline = this.now() + maxWaitMs;
    for (;;) {
      if (this.tryAcquire(lane)) return true;
      const wait = Math.max(1, this.msUntilAvailable(lane));
      if (!Number.isFinite(wait) || this.now() + wait > deadline) return false;
      await sleep(wait);
    }
  }

  /** Block all acquisitions until `untilMs` (e.g. after an upstream 429). */
  pauseUntil(untilMs: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, untilMs);
  }

  get used(): number {
    this.prune(this.now());
    return this.stamps.length;
  }

  private prune(now: number) {
    while (this.stamps.length && this.stamps[0] + this.windowMs <= now) {
      this.stamps.shift();
    }
  }
}

/**
 * Parse a rate-limit reset hint into a wait in ms.
 * Accepts `retry-after` (seconds or HTTP date) and `x-ratelimit-reset`
 * (Jupiter sends an absolute Unix timestamp in seconds; a small value is
 * treated as seconds remaining). Returns undefined when no usable hint.
 */
export function parseResetWaitMs(
  headers: Pick<Headers, 'get'>,
  now: number = Date.now(),
): number | undefined {
  const reset = headers.get('x-ratelimit-reset');
  if (reset != null && reset.trim() !== '') {
    const n = Number(reset);
    if (Number.isFinite(n) && n >= 0) {
      // > ~2001-09 in seconds → absolute epoch seconds; otherwise a delta.
      return n > 1_000_000_000 ? Math.max(0, n * 1000 - now) : n * 1000;
    }
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter != null && retryAfter.trim() !== '') {
    const n = Number(retryAfter);
    if (Number.isFinite(n) && n >= 0) return n * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
