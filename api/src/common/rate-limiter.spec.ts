import { parseResetWaitMs, SlidingWindowRateLimiter } from './rate-limiter';

function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe('SlidingWindowRateLimiter', () => {
  it('allows rps × 60 per rolling minute and frees slots as they age out', () => {
    const c = clock();
    const limiter = new SlidingWindowRateLimiter(0.5, c.now);
    expect(limiter.limit).toBe(30);

    for (let i = 0; i < 30; i++) {
      expect(limiter.tryAcquire()).toBe(true);
      c.advance(100);
    }
    expect(limiter.tryAcquire()).toBe(false);
    // Oldest stamp was taken 3s ago → frees 57s later.
    expect(limiter.msUntilAvailable()).toBe(57_000);

    c.advance(57_000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('never allows less than one request per window', () => {
    expect(new SlidingWindowRateLimiter(0.001).limit).toBe(1);
  });

  it('rejects invalid budgets', () => {
    expect(() => new SlidingWindowRateLimiter(0)).toThrow();
    expect(() => new SlidingWindowRateLimiter(Number.NaN)).toThrow();
  });

  it('pauses all acquisitions after an upstream 429', () => {
    const c = clock();
    const limiter = new SlidingWindowRateLimiter(10, c.now);
    limiter.pauseUntil(c.now() + 2_000);
    expect(limiter.tryAcquire()).toBe(false);
    expect(limiter.msUntilAvailable()).toBe(2_000);
    c.advance(2_000);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('acquire waits for a slot within maxWait and fails fast beyond it', async () => {
    const c = clock();
    const limiter = new SlidingWindowRateLimiter(1 / 60, c.now); // 1 per minute
    const sleep = jest.fn((ms: number) => {
      c.advance(ms);
      return Promise.resolve();
    });

    expect(await limiter.acquire(0, sleep)).toBe(true);
    expect(await limiter.acquire(5_000, sleep)).toBe(false);
    expect(sleep).not.toHaveBeenCalled();

    c.advance(55_000);
    expect(await limiter.acquire(10_000, sleep)).toBe(true);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });
});

describe('SlidingWindowRateLimiter lanes', () => {
  it('keeps a reserved slice of the window for priority callers', () => {
    const c = clock();
    const limiter = new SlidingWindowRateLimiter(0.5, c.now, 60_000, {
      reservedForPriority: 0.5,
    });
    expect(limiter.limit).toBe(30);
    expect(limiter.reserved).toBe(15);
    for (let i = 0; i < 15; i++) {
      expect(limiter.tryAcquire('background')).toBe(true);
    }
    // Background is capped; priority still has the reserved 15.
    expect(limiter.tryAcquire('background')).toBe(false);
    for (let i = 0; i < 15; i++) {
      expect(limiter.tryAcquire('priority')).toBe(true);
    }
    expect(limiter.tryAcquire('priority')).toBe(false);
  });

  it('background waits for its own capacity, priority for the full window', () => {
    const c = clock();
    const limiter = new SlidingWindowRateLimiter(0.1, c.now, 60_000, {
      reservedForPriority: 0.5,
    });
    // limit 6, reserved 3
    for (let i = 0; i < 3; i++) {
      limiter.tryAcquire('background');
      c.advance(1_000);
    }
    expect(limiter.msUntilAvailable('priority')).toBe(0);
    // Oldest background stamp (t0) ages out 60s after it was taken.
    expect(limiter.msUntilAvailable('background')).toBe(57_000);
  });

  it('a priority-only limiter never admits background traffic', async () => {
    const limiter = new SlidingWindowRateLimiter(1, () => 0, 60_000, {
      reservedForPriority: 1,
    });
    expect(limiter.tryAcquire('background')).toBe(false);
    expect(await limiter.acquire(10_000, jest.fn(), 'background')).toBe(false);
    expect(limiter.tryAcquire('priority')).toBe(true);
  });

  it('without a reservation both lanes share the whole window', () => {
    const limiter = new SlidingWindowRateLimiter(1, () => 0);
    expect(limiter.reserved).toBe(0);
    for (let i = 0; i < 60; i++) {
      expect(limiter.tryAcquire('background')).toBe(true);
    }
    expect(limiter.tryAcquire('priority')).toBe(false);
  });
});

describe('parseResetWaitMs', () => {
  const now = 1_800_000_000_000;

  it('treats a large x-ratelimit-reset as absolute epoch seconds (Jupiter)', () => {
    expect(
      parseResetWaitMs(headers({ 'x-ratelimit-reset': '1800000003' }), now),
    ).toBe(3_000);
  });

  it('treats a small x-ratelimit-reset as seconds remaining', () => {
    expect(parseResetWaitMs(headers({ 'x-ratelimit-reset': '7' }), now)).toBe(
      7_000,
    );
  });

  it('falls back to retry-after seconds or HTTP date', () => {
    expect(parseResetWaitMs(headers({ 'retry-after': '2' }), now)).toBe(2_000);
    expect(
      parseResetWaitMs(
        headers({ 'retry-after': new Date(now + 4_000).toUTCString() }),
        now,
      ),
    ).toBe(4_000);
  });

  it('returns undefined without hints', () => {
    expect(parseResetWaitMs(headers({}), now)).toBeUndefined();
  });
});
