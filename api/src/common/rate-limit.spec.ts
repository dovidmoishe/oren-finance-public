import { HttpException } from '@nestjs/common';
import {
  AgentUsageLimit,
  RateLimitGuard,
  SlidingWindowLimiter,
  clientIp,
} from './rate-limit';

function context(method: string, path: string, ip = '203.0.113.5') {
  const response = { setHeader: jest.fn() };
  return {
    response,
    ctx: {
      switchToHttp: () => ({
        getRequest: () => ({ method, path, ip }),
        getResponse: () => response,
      }),
    } as never,
  };
}

function status(error: unknown) {
  return (error as HttpException).getStatus();
}

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit, then reports the wait until a slot frees', () => {
    const limiter = new SlidingWindowLimiter(2, 10_000);
    expect(limiter.hit('k', 1_000)).toBe(0);
    expect(limiter.hit('k', 2_000)).toBe(0);
    expect(limiter.hit('k', 3_000)).toBe(8);
    expect(limiter.hit('k', 11_001)).toBe(0);
  });

  it('keeps keys independent', () => {
    const limiter = new SlidingWindowLimiter(1, 10_000);
    expect(limiter.hit('a', 0)).toBe(0);
    expect(limiter.hit('a', 1)).toBeGreaterThan(0);
    expect(limiter.hit('b', 1)).toBe(0);
  });

  it('bounds memory under many distinct keys', () => {
    const limiter = new SlidingWindowLimiter(1, 10_000, 100);
    for (let i = 0; i < 1_000; i++) limiter.hit(`ip-${i}`, i);
    expect(
      (limiter as unknown as { hits: Map<string, number[]> }).hits.size,
    ).toBeLessThanOrEqual(101);
  });
});

describe('RateLimitGuard', () => {
  it('limits agent messages per address and sets Retry-After', () => {
    const guard = new RateLimitGuard();
    for (let i = 0; i < 20; i++)
      expect(guard.canActivate(context('POST', '/api/agent/message').ctx)).toBe(
        true,
      );
    const { ctx, response } = context('POST', '/api/agent/message/stream');
    let thrown: unknown;
    try {
      guard.canActivate(ctx);
    } catch (error) {
      thrown = error;
    }
    expect(status(thrown)).toBe(429);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    // Another client is unaffected.
    expect(
      guard.canActivate(
        context('POST', '/api/agent/message', '198.51.100.2').ctx,
      ),
    ).toBe(true);
  });

  it('limits paid-provider routes such as quotes and stock news', () => {
    const guard = new RateLimitGuard();
    for (let i = 0; i < 30; i++) {
      guard.canActivate(context('POST', '/api/execution/quote').ctx);
      guard.canActivate(context('GET', '/api/stocks/nvda/news').ctx);
    }
    expect(() =>
      guard.canActivate(context('GET', '/api/signals/nvda').ctx),
    ).toThrow(HttpException);
  });

  it('never limits health checks or CORS preflights', () => {
    const guard = new RateLimitGuard();
    for (let i = 0; i < 1_000; i++) {
      expect(guard.canActivate(context('GET', '/api/health/ready').ctx)).toBe(
        true,
      );
      expect(
        guard.canActivate(context('OPTIONS', '/api/agent/message').ctx),
      ).toBe(true);
    }
  });

  it('applies a generous default to ordinary reads', () => {
    const guard = new RateLimitGuard();
    for (let i = 0; i < 600; i++)
      guard.canActivate(context('GET', '/api/stocks').ctx);
    expect(() => guard.canActivate(context('GET', '/api/stocks').ctx)).toThrow(
      HttpException,
    );
  });
});

describe('AgentUsageLimit', () => {
  it('caps each wallet per day without affecting other wallets', () => {
    const limit = new AgentUsageLimit();
    for (let i = 0; i < 200; i++) limit.assertAllowed('wallet-a');
    expect(() => limit.assertAllowed('wallet-a')).toThrow(HttpException);
    expect(() => limit.assertAllowed('wallet-b')).not.toThrow();
  });
});

describe('clientIp', () => {
  it('prefers the Express-resolved address and falls back to the socket', () => {
    expect(clientIp({ ip: '203.0.113.1' })).toBe('203.0.113.1');
    expect(clientIp({ socket: { remoteAddress: '10.0.0.2' } })).toBe(
      '10.0.0.2',
    );
    expect(clientIp({})).toBe('unknown');
  });
});
