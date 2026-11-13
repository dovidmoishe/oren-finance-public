import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import {
  TokensApiUnavailableError,
  TokensBadRequestError,
  TokensNotFoundError,
} from '../common/errors/provider.errors';
import type { TokensErrorBody } from './tokens.types';

@Injectable()
export class TokensClient {
  private readonly logger = new Logger(TokensClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.baseUrl = `${env.TOKENS_API_BASE_URL}/v1`;
    this.apiKey = env.TOKENS_API_KEY;
  }

  async getHealth(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - start;
    return { ok: res.ok, latencyMs };
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.request<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(
      path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`,
    );
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'x-api-key': this.apiKey,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new TokensApiUnavailableError('Tokens API network error', err);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (requestId) {
      this.logger.debug(`Tokens request ${url} x-request-id=${requestId}`);
    }

    if (response.ok) {
      if (response.status === 204) {
        return undefined as T;
      }
      return (await response.json()) as T;
    }

    let body: TokensErrorBody | undefined;
    try {
      body = (await response.json()) as TokensErrorBody;
    } catch {
      body = undefined;
    }

    const message =
      body?.error?.message ??
      `Tokens API error ${response.status} for ${url}`;

    if (response.status === 404) {
      throw new TokensNotFoundError(message, body);
    }
    if (response.status === 400) {
      throw new TokensBadRequestError(message, body);
    }
    if (response.status === 429) {
      throw new TokensApiUnavailableError(
        `Tokens API rate limited: ${message}`,
        body,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new TokensApiUnavailableError(
        `Tokens API auth error: ${message}`,
        body,
      );
    }

    throw new TokensApiUnavailableError(message, body);
  }
}
