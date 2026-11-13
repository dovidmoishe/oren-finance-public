import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * In-memory sliding-window limiter. The API runs as a single instance behind
 * Caddy, so process memory is the shared state; restart resets the windows.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Records a hit and returns 0, or the seconds to wait when over the limit. */
  hit(key: string, now = Date.now()): number {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.sweep(since);
    return 0;
  }

  private sweep(since: number) {
    for (const [key, times] of this.hits) {
      if (!times.length || times[times.length - 1] <= since)
        this.hits.delete(key);
    }
    // Still full of active keys: drop the oldest entries rather than grow.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

export function tooManyRequests(
  retryAfter: number,
  response?: { setHeader?: (name: string, value: string) => void },
): HttpException {
  response?.setHeader?.('Retry-After', String(retryAfter));
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Too many requests. Try again shortly.',
      error: 'RATE_LIMITED',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

interface RateRule {
  name: string;
  matches: (method: string, path: string) => boolean;
  limiter: SlidingWindowLimiter;
}

const MINUTE = 60_000;

/** Shared by direct provider HTTP routes and paid tool calls inside one agent turn. */
export const PROVIDER_REQUESTS_PER_MINUTE = 60;
const post = (paths: string[]) => (method: string, path: string) =>
  method === 'POST' && paths.includes(path);
const getMatching = (pattern: RegExp) => (method: string, path: string) =>
  method === 'GET' && pattern.test(path);

/**
 * Per-IP limits. LLM and paid-provider routes get tight buckets; everything
 * under /api shares a generous default so normal browsing never trips it.
 */
export function defaultRateRules(): RateRule[] {
  return [
    {
      name: 'agent',
      matches: post(['/api/agent/message', '/api/agent/message/stream']),
      limiter: new SlidingWindowLimiter(20, MINUTE),
    },
    {
      name: 'providers',
      matches: (method, path) =>
        post([
          '/api/execution/quote',
          '/api/execution/basket',
          '/api/execution/limit-order',
          '/api/social/copy-portfolio/prepare',
        ])(method, path) ||
        getMatching(
          /^\/api\/(stocks\/[^/]+\/(news|analysis|chart)|signals\/[^/]+|research\/.+|markets\/(trending|opportunities))$/,
        )(method, path),
      limiter: new SlidingWindowLimiter(PROVIDER_REQUESTS_PER_MINUTE, MINUTE),
    },
    {
      name: 'default',
      matches: (_method, path) => path.startsWith('/api/'),
      limiter: new SlidingWindowLimiter(600, MINUTE),
    },
  ];
}

/** Client address as Express resolves it; behind Caddy `trust proxy` is set. */
export function clientIp(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return request.ip || request.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly rules = defaultRateRules();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      path: string;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    if (request.method === 'OPTIONS') return true;
    const path = request.path.replace(/\/+$/, '');
    if (path.startsWith('/api/health')) return true;
    const ip = clientIp(request);
    // A request counts against every bucket it falls in, specific first.
    for (const rule of this.rules) {
      if (!rule.matches(request.method, path)) continue;
      const retryAfter = rule.limiter.hit(`${rule.name}:${ip}`);
      if (retryAfter)
        throw tooManyRequests(
          retryAfter,
          http.getResponse<{ setHeader?: (n: string, v: string) => void }>(),
        );
    }
    return true;
  }
}

/**
 * Daily agent budget per authenticated wallet. Checked only after the caller
 * proves wallet ownership, so nobody can spend another wallet's allowance.
 */
/**
 * Paid provider work started by an agent tool. Keyed by the wallet the request
 * already proved, so one chat cannot spend another wallet's minute. This is
 * separate from the per-message IP cap and the daily wallet cap.
 */
@Injectable()
export class PaidProviderToolBudget {
  private readonly calls = new SlidingWindowLimiter(
    PROVIDER_REQUESTS_PER_MINUTE,
    MINUTE,
  );

  assertAllowed(walletAddress: string) {
    const retryAfter = this.calls.hit(walletAddress);
    if (retryAfter) throw tooManyRequests(retryAfter);
  }
}

@Injectable()
export class AgentUsageLimit {
  private readonly daily = new SlidingWindowLimiter(200, 24 * 60 * MINUTE);

  assertAllowed(
    walletAddress: string,
    response?: { setHeader?: (name: string, value: string) => void },
  ) {
    const retryAfter = this.daily.hit(walletAddress);
    if (retryAfter) throw tooManyRequests(retryAfter, response);
  }
}
