import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import {
  JupiterRateLimitedError,
  JupiterUnavailableError,
} from '../../common/errors/provider.errors';
import {
  parseResetWaitMs,
  type RateLane,
  SlidingWindowRateLimiter,
} from '../../common/rate-limiter';

/** Longest a request will queue for local budget before failing fast. */
export const JUPITER_MAX_QUEUE_MS = 8_000;
/** Retries after an upstream 429 (reset-header or backoff wait each time). */
export const JUPITER_MAX_429_RETRIES = 2;
const JUPITER_BACKOFF_BASE_MS = 1_000;
const JUPITER_REQUEST_TIMEOUT_MS = 30_000;
/**
 * Share of the window that background traffic (the limit-order fill poller)
 * can never use, so user quotes and swap builds always have budget left.
 */
export const JUPITER_PRIORITY_RESERVE = 0.5;

export interface JupiterGatewayOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

/**
 * Single choke point for every api.jup.ag call (swap quote, swap build and
 * trigger). Holds the shared per-organisation budget, injects `x-api-key`,
 * and honours 429s (x-ratelimit-reset when present, else exponential backoff).
 * Quote, swap-build and trigger order calls only return unsigned payloads,
 * so retrying them after a 429 is side-effect free. (A 429 also means the
 * request was not processed.)
 */
@Injectable()
export class JupiterGateway {
  private readonly logger = new Logger(JupiterGateway.name);
  private readonly apiKey?: string;
  readonly limiter: SlidingWindowRateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Optional() options?: JupiterGatewayOptions,
  ) {
    this.apiKey = env.JUPITER_API_KEY;
    this.now = options?.now ?? Date.now;
    this.sleep =
      options?.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.fetchImpl =
      options?.fetchImpl ??
      ((input: string | URL | Request, init?: RequestInit) =>
        fetch(input, init));
    this.limiter = new SlidingWindowRateLimiter(
      env.JUPITER_MAX_RPS ?? (env.JUPITER_API_KEY ? 1 : 0.5),
      this.now,
      undefined,
      { reservedForPriority: JUPITER_PRIORITY_RESERVE },
    );
  }

  get hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * `lane` = 'background' for work no user is waiting on (pollers); it can
   * only use the non-reserved part of the window.
   */
  async fetch(
    url: string,
    init: RequestInit,
    label: string,
    lane: RateLane = 'priority',
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    // Only ever send the key to Jupiter itself, never to an overridden host.
    if (this.apiKey && isJupiterHost(url)) {
      headers.set('x-api-key', this.apiKey);
    }

    for (let attempt = 0; ; attempt++) {
      const acquired = await this.limiter.acquire(
        JUPITER_MAX_QUEUE_MS,
        this.sleep,
        lane,
      );
      if (!acquired) {
        throw new JupiterRateLimitedError();
      }

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(JUPITER_REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new JupiterUnavailableError(`${label} network error`, err);
      }

      if (response.status !== 429) return response;

      const hinted = parseResetWaitMs(response.headers, this.now());
      const waitMs = hinted ?? JUPITER_BACKOFF_BASE_MS * 2 ** attempt;
      // Everyone sharing the key should back off, not just this caller.
      this.limiter.pauseUntil(this.now() + waitMs);
      this.logger.warn(
        `${label} HTTP 429 (attempt ${attempt + 1}); backing off ${waitMs}ms`,
      );
      await response.body?.cancel().catch(() => undefined);

      if (attempt >= JUPITER_MAX_429_RETRIES || waitMs > JUPITER_MAX_QUEUE_MS) {
        throw new JupiterRateLimitedError();
      }
    }
  }
}

export function isJupiterHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'jup.ag' || host.endsWith('.jup.ag');
  } catch {
    return false;
  }
}
