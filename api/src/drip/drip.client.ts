import {
  DRIP_OPINION_FETCH_LIMIT,
  DRIP_PICKS_FETCH_DAYS,
  DRIP_PICKS_FETCH_LIMIT,
} from './drip.types';

export type DripErrorKind =
  | 'unset'
  | 'timeout'
  | 'network'
  | 'rate_limit'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'http'
  | 'malformed';

/**
 * Account-mount Drip client.
 * Auth is `Authorization: Bearer <DRIP_API_KEY>` on `https://dripstack.com`.
 * The key stays on this object and is never written into errors or URLs.
 */
export class DripRequestError extends Error {
  constructor(
    message: string,
    readonly kind: DripErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DripRequestError';
  }
}

export interface DripClientOptions {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class DripClient {
  constructor(private readonly options: DripClientOptions) {}

  /** `GET /api/v2/tickers/{ticker}` — calls on one ticker, grouped by analyst. */
  getTicker(ticker: string): Promise<unknown> {
    return this.request(`/api/v2/tickers/${encodeURIComponent(ticker)}`, {
      limit: String(DRIP_OPINION_FETCH_LIMIT),
      sort: 'newest',
    });
  }

  /** `GET /api/v2/stock-picks` — latest in-window picks, prices omitted. */
  getLatestPicks(): Promise<unknown> {
    return this.request('/api/v2/stock-picks', {
      limitDays: String(DRIP_PICKS_FETCH_DAYS),
      limit: String(DRIP_PICKS_FETCH_LIMIT),
      sort: 'newest',
      includePrices: 'false',
    });
  }

  private async request(
    path: string,
    query: Record<string, string>,
  ): Promise<unknown> {
    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) {
      throw new DripRequestError('Drip API key is not configured', 'unset');
    }

    const url = new URL(path, ensureSlash(this.options.baseUrl));
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (response.ok) return parseJson(text);
      throw httpError(response.status);
    } catch (error) {
      if (error instanceof DripRequestError) throw error;
      if (controller.signal.aborted) {
        throw new DripRequestError(
          `Drip request timed out after ${this.options.timeoutMs}ms`,
          'timeout',
        );
      }
      throw new DripRequestError('Drip request failed', 'network');
    } finally {
      clearTimeout(timer);
    }
  }
}

function ensureSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DripRequestError('Drip returned invalid JSON', 'malformed');
  }
}

function httpError(status: number): DripRequestError {
  if (status === 429) {
    return new DripRequestError(
      'Drip request allowance is exhausted',
      'rate_limit',
      status,
    );
  }
  if (status === 401) {
    return new DripRequestError(
      'Drip rejected the API key',
      'unauthorized',
      status,
    );
  }
  if (status === 403) {
    return new DripRequestError(
      'Drip refused the request',
      'forbidden',
      status,
    );
  }
  if (status === 404) {
    return new DripRequestError(
      'Drip has no matching opinions',
      'not_found',
      status,
    );
  }
  if (status === 400) {
    return new DripRequestError(
      'Drip rejected the query',
      'bad_request',
      status,
    );
  }
  return new DripRequestError(
    `Drip request failed (${status})`,
    'http',
    status,
  );
}
