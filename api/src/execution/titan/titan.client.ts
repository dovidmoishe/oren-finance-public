import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { APP_ENV } from '../../config/constants';
import {
  type AppEnv,
  DEFAULT_TITAN_MAX_PRICE_DEVIATION_BPS,
} from '../../config/env.schema';
import { CircuitBreaker } from '../../common/circuit-breaker';
import {
  parseResetWaitMs,
  type RateLane,
  SlidingWindowRateLimiter,
} from '../../common/rate-limiter';
import { TitanError } from './titan.errors';
import type { TitanQuoteParams, TitanQuoteResponse } from './titan.types';

export const TITAN_TIMEOUT_MS = 4_000;
/** Fallback cool-down when a rate_limited 429 carries no retry hint. */
const RATE_LIMITED_DEFAULT_COOLDOWN_MS = 30_000;
/** allowance_exhausted does not clear by retrying; re-probe hourly. */
const ALLOWANCE_EXHAUSTED_COOLDOWN_MS = 60 * 60_000;
/** A bad key burns credits on every call; stop until someone fixes it. */
const INVALID_KEY_COOLDOWN_MS = 10 * 60_000;
/** Consecutive timeouts / 5xx before the breaker opens, and for how long. */
const FAILURE_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 30_000;
/**
 * Share of the Titan window only prepare-time re-quotes ('priority') may
 * use. Quotes, shadow traffic and auto-refreshes run on 'background' and can
 * never take it, so a reviewed Titan route can always be refreshed.
 */
export const TITAN_PRIORITY_RESERVE = 1 / 3;

export interface TitanClientOptions {
  now?: () => number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Server-only Titan Portal client. The API key never leaves the API process.
 * Budgeting is "skip, don't wait": when the local window is spent or the
 * breaker is open, calls fail immediately so the router can use Jupiter.
 */
@Injectable()
export class TitanClient {
  private readonly logger = new Logger(TitanClient.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxPriceDeviationBps: number;
  readonly limiter: SlidingWindowRateLimiter;
  readonly breaker: CircuitBreaker;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Optional() options?: TitanClientOptions,
  ) {
    this.apiKey = env.TITAN_API_KEY;
    this.baseUrl = (
      env.TITAN_API_URL ?? 'https://portal.api.titan.exchange'
    ).replace(/\/$/, '');
    this.now = options?.now ?? Date.now;
    this.fetchImpl =
      options?.fetchImpl ??
      ((input: string | URL | Request, init?: RequestInit) =>
        fetch(input, init));
    this.timeoutMs = options?.timeoutMs ?? TITAN_TIMEOUT_MS;
    this.maxPriceDeviationBps =
      env.TITAN_MAX_PRICE_DEVIATION_BPS ??
      DEFAULT_TITAN_MAX_PRICE_DEVIATION_BPS;
    this.limiter = new SlidingWindowRateLimiter(
      env.TITAN_MAX_RPS ?? 1,
      this.now,
      undefined,
      { reservedForPriority: TITAN_PRIORITY_RESERVE },
    );
    this.breaker = new CircuitBreaker(
      FAILURE_THRESHOLD,
      FAILURE_COOLDOWN_MS,
      this.now,
    );
  }

  /** Kill switch: no key → Titan is never called. */
  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * `lane`: 'background' for quotes (incl. shadow and auto-refresh),
   * 'priority' only for the re-quote at prepare time.
   */
  async quoteSwap(
    params: TitanQuoteParams,
    lane: RateLane = 'background',
  ): Promise<TitanQuoteResponse> {
    if (!this.apiKey) {
      throw new TitanError('disabled', 'TITAN_API_KEY is not configured');
    }
    if (this.breaker.isOpen()) {
      throw new TitanError(
        'breaker_open',
        `Titan paused for ${Math.ceil(this.breaker.openForMs / 1000)}s (${this.breaker.openReason})`,
      );
    }
    if (!this.limiter.tryAcquire(lane)) {
      throw new TitanError('skipped_rate_budget', 'Titan rate budget spent');
    }

    const url = new URL(`${this.baseUrl}/api/v1/quote/swap`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount);
    url.searchParams.set('userPublicKey', params.userPublicKey);
    url.searchParams.set('slippageBps', String(params.slippageBps));
    url.searchParams.set(
      'maxPriceDeviationBps',
      String(params.maxPriceDeviationBps ?? this.maxPriceDeviationBps),
    );
    if (params.includeAltContents) {
      url.searchParams.set('includeAltContents', 'true');
    }
    if (params.numQuotes !== undefined) {
      url.searchParams.set('numQuotes', String(params.numQuotes));
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      this.breaker.recordFailure(timeout ? 'timeouts' : 'network errors');
      throw new TitanError(
        timeout ? 'timeout' : 'network',
        timeout
          ? `Titan quote timed out after ${this.timeoutMs}ms`
          : 'Titan network error',
        undefined,
        err,
      );
    }

    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (err) {
        this.breaker.recordFailure('invalid responses');
        throw new TitanError(
          'invalid_response',
          'Titan returned non-JSON',
          200,
          err,
        );
      }
      if (!isQuoteResponse(body)) {
        this.breaker.recordFailure('invalid responses');
        throw new TitanError(
          'invalid_response',
          'Titan response missing quotes',
          200,
        );
      }
      this.breaker.recordSuccess();
      return body;
    }

    throw await this.toError(response);
  }

  private async toError(response: Response): Promise<TitanError> {
    const status = response.status;
    const text = await response.text().catch(() => '');
    const body = safeJson(text);
    const platformCode = readPlatformCode(body);
    const requestId = response.headers.get('x-amzn-requestid') ?? undefined;
    const detail = `${status}${platformCode ? ` ${platformCode}` : ''}${
      requestId ? ` request=${requestId}` : ''
    }`;

    if (status === 401) {
      this.breaker.trip(INVALID_KEY_COOLDOWN_MS, 'invalid_api_key');
      this.logger.error(`Titan rejected the API key (${detail})`);
      return new TitanError('invalid_api_key', 'Titan API key rejected', 401);
    }
    if (status === 429) {
      if (platformCode === 'allowance_exhausted') {
        this.breaker.trip(
          ALLOWANCE_EXHAUSTED_COOLDOWN_MS,
          'allowance_exhausted',
        );
        this.logger.error(
          `Titan monthly credit allowance exhausted (${detail}); pausing Titan`,
        );
        return new TitanError(
          'allowance_exhausted',
          'Titan credit allowance exhausted',
          429,
        );
      }
      const waitMs =
        parseResetWaitMs(response.headers, this.now()) ??
        RATE_LIMITED_DEFAULT_COOLDOWN_MS;
      this.breaker.trip(waitMs, 'rate_limited');
      this.logger.warn(`Titan rate limited (${detail}); pausing ${waitMs}ms`);
      return new TitanError('rate_limited', 'Titan rate limited', 429);
    }
    if (status === 404) {
      // -7 = no route. A 404 without metadata.errors is a request problem
      // (typically an unusable userPublicKey) — still "no route" for us.
      this.breaker.recordSuccess();
      return new TitanError(
        'no_route',
        `Titan found no route (${detail})`,
        404,
      );
    }
    if (status === 400) {
      this.breaker.recordSuccess();
      return new TitanError(
        'bad_request',
        `Titan rejected the request (${detail}): ${text.slice(0, 200)}`,
        400,
      );
    }
    if (status === 403) {
      // Unknown path/method: a config problem that burns a credit per call.
      this.breaker.trip(INVALID_KEY_COOLDOWN_MS, 'forbidden');
      this.logger.error(`Titan rejected the path or method (${detail})`);
      return new TitanError(
        'forbidden',
        `Titan unknown path/method (${detail})`,
        403,
      );
    }
    this.breaker.recordFailure(`HTTP ${status}`);
    return new TitanError('upstream_error', `Titan HTTP ${detail}`, status);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readPlatformCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === 'number' || typeof code === 'string'
    ? String(code)
    : undefined;
}

function isQuoteResponse(body: unknown): body is TitanQuoteResponse {
  return (
    !!body &&
    typeof body === 'object' &&
    typeof (body as { quotes?: unknown }).quotes === 'object' &&
    (body as { quotes?: unknown }).quotes !== null
  );
}
