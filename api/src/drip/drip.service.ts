import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Equity } from '../../types/equity';
import {
  APP_ENV,
  DRIP_PICKS_TTL_MS,
  DRIP_TICKER_TTL_MS,
} from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { MarketService } from '../market/market.service';
import { dripToolsEnabled, type DripCaller } from './drip-access';
import { TtlCache } from './drip-cache';
import { DripClient, DripRequestError } from './drip.client';
import {
  compactPicks,
  compactTickerCoverage,
  emptyOpinions,
  presentOpinions,
  presentPicks,
} from './drip.mapper';
import { resolveDripTicker } from './drip-symbols';
import { DripQuotaService } from './drip-quota.service';
import type {
  CachedDripOpinions,
  CachedDripPicks,
  DripFailureReason,
  DripOpinionFilter,
  DripOpinionResult,
  DripPicksResult,
  DripUnavailable,
} from './drip.types';
import {
  DRIP_OPINION_RETURN_DEFAULT,
  DRIP_OPINION_RETURN_MAX,
  DRIP_PICKS_RETURN_DEFAULT,
  DRIP_PICKS_RETURN_MAX,
} from './drip.types';

const FAILURE_MESSAGE: Record<DripFailureReason, string> = {
  DRIP_UNSET:
    'Drip is not configured, so writer opinions could not be fetched.',
  DRIP_TIMEOUT:
    'Drip did not respond in time, so writer opinions could not be fetched.',
  DRIP_RATE_LIMITED:
    'Drip request allowance is exhausted, so writer opinions could not be fetched.',
  DRIP_FORBIDDEN:
    'Drip refused this request, so writer opinions could not be fetched.',
  DRIP_UNAVAILABLE:
    'Drip opinions could not be fetched. Continue without them.',
  DRIP_BAD_TICKER: 'That symbol could not be mapped to a Drip equity ticker.',
};

@Injectable()
export class DripService {
  private readonly logger = new Logger(DripService.name);
  private readonly client: DripClient;
  private readonly cache = new TtlCache();

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly market: MarketService,
    private readonly quota?: DripQuotaService,
  ) {
    this.client = new DripClient({
      apiKey: env.DRIP_API_KEY,
      baseUrl: env.DRIP_API_BASE_URL,
      timeoutMs: env.DRIP_REQUEST_TIMEOUT_MS,
    });
  }

  enabledFor(caller: DripCaller): boolean {
    return dripToolsEnabled(
      {
        enabled: this.env.DRIP_ENABLED,
        publicResearch: this.env.DRIP_PUBLIC_RESEARCH_ENABLED,
      },
      caller,
    );
  }

  async getOpinions(
    queried: string,
    limit = DRIP_OPINION_RETURN_DEFAULT,
    caller?: DripCaller,
    filter?: DripOpinionFilter,
  ): Promise<DripOpinionResult> {
    const bounded = clampLimit(
      limit,
      DRIP_OPINION_RETURN_DEFAULT,
      DRIP_OPINION_RETURN_MAX,
    );
    if (!this.env.DRIP_API_KEY) return this.unavailable('DRIP_UNSET', queried);
    try {
      const resolved = await resolveDripTicker(queried, (query) =>
        this.lookupEquity(query),
      );
      if (!resolved) return this.unavailable('DRIP_BAD_TICKER', queried);
      const cached = await this.cache.getOrLoad(
        `ticker:${resolved.ticker}`,
        DRIP_TICKER_TTL_MS,
        async () => {
          if (caller?.userId && !(await this.claim(caller.userId))) {
            throw new DripRequestError(
              'Drip request allowance is exhausted',
              'rate_limit',
            );
          }
          return this.loadTicker(resolved.ticker);
        },
      );
      return presentOpinions(
        cached,
        queried,
        resolved.mappedFrom,
        bounded,
        filter,
      );
    } catch (error) {
      this.logFailure('opinions', queried, error);
      return this.unavailable(reasonFor(error), queried);
    }
  }

  async getPicks(
    limit = DRIP_PICKS_RETURN_DEFAULT,
    caller?: DripCaller,
  ): Promise<DripPicksResult> {
    const bounded = clampLimit(
      limit,
      DRIP_PICKS_RETURN_DEFAULT,
      DRIP_PICKS_RETURN_MAX,
    );
    if (!this.env.DRIP_API_KEY) return this.unavailable('DRIP_UNSET');
    try {
      const cached = await this.cache.getOrLoad(
        'picks:latest',
        DRIP_PICKS_TTL_MS,
        async () => {
          if (caller?.userId && !(await this.claim(caller.userId))) {
            throw new DripRequestError(
              'Drip request allowance is exhausted',
              'rate_limit',
            );
          }
          return this.loadPicks();
        },
      );
      return presentPicks(cached, bounded);
    } catch (error) {
      this.logFailure('picks', 'latest', error);
      return this.unavailable(reasonFor(error));
    }
  }

  private async loadTicker(ticker: string): Promise<CachedDripOpinions> {
    try {
      const body = await this.client.getTicker(ticker);
      const compact = compactTickerCoverage(body);
      if (!compact) {
        throw new DripRequestError(
          'Drip returned an unexpected ticker payload',
          'malformed',
        );
      }
      return compact;
    } catch (error) {
      if (error instanceof DripRequestError && error.kind === 'not_found') {
        return emptyOpinions(ticker);
      }
      throw error;
    }
  }

  private async claim(userId: string): Promise<boolean> {
    if (!this.quota) return true;
    try {
      return await this.quota.claim(userId);
    } catch {
      return false;
    }
  }

  private async loadPicks(): Promise<CachedDripPicks> {
    try {
      const body = await this.client.getLatestPicks();
      const compact = compactPicks(body);
      if (!compact) {
        throw new DripRequestError(
          'Drip returned an unexpected picks payload',
          'malformed',
        );
      }
      return compact;
    } catch (error) {
      if (error instanceof DripRequestError && error.kind === 'not_found') {
        return { truncated: false, picks: [] };
      }
      throw error;
    }
  }

  private async lookupEquity(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return null;
    try {
      const stock = await this.market.getStock(trimmed);
      if (acceptsEquity(stock, trimmed)) return toMatch(stock);
    } catch {
      // Unknown ids and xStock symbols fall through to search or the suffix rule.
    }
    try {
      const results = await this.market.searchStocks(trimmed);
      const match = results.find(
        (item) => item.ticker.trim().toUpperCase() === trimmed.toUpperCase(),
      );
      if (!match) return null;
      const stock = await this.market.getStock(match.id);
      return acceptsEquity(stock, trimmed) ? toMatch(stock) : null;
    } catch {
      return null;
    }
  }

  private unavailable(
    reason: DripFailureReason,
    queried?: string,
  ): DripUnavailable {
    return {
      available: false,
      source: 'drip',
      reason,
      queried,
      message: FAILURE_MESSAGE[reason],
    };
  }

  private logFailure(scope: string, detail: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof DripRequestError ? error.kind : 'unknown';
    const status =
      error instanceof DripRequestError && error.status
        ? ` ${error.status}`
        : '';
    this.logger.warn(
      `Drip ${scope} failed (${kind}${status}) for ${redact(detail, this.env.DRIP_API_KEY)}: ${redact(message, this.env.DRIP_API_KEY)}`,
    );
  }
}

function acceptsEquity(stock: Equity, query: string): boolean {
  if (stock.id === query) return true;
  if (stock.ticker.trim().toUpperCase() === query.toUpperCase()) return true;
  return stock.variants.some(
    (variant) => variant.symbol.trim().toUpperCase() === query.toUpperCase(),
  );
}

function toMatch(stock: Equity) {
  return {
    ticker: stock.ticker,
    variants: stock.variants.map((variant) => ({ symbol: variant.symbol })),
  };
}

function reasonFor(error: unknown): DripFailureReason {
  if (!(error instanceof DripRequestError)) return 'DRIP_UNAVAILABLE';
  switch (error.kind) {
    case 'unset':
      return 'DRIP_UNSET';
    case 'timeout':
      return 'DRIP_TIMEOUT';
    case 'rate_limit':
      return 'DRIP_RATE_LIMITED';
    case 'unauthorized':
    case 'forbidden':
      return 'DRIP_FORBIDDEN';
    case 'bad_request':
      return 'DRIP_BAD_TICKER';
    default:
      return 'DRIP_UNAVAILABLE';
  }
}

function clampLimit(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  const floored = Math.floor(value);
  if (floored < 1) return fallback;
  return Math.min(max, floored);
}

function redact(message: string, secret: string | undefined): string {
  if (!secret || secret.length < 8) return message;
  return message.split(secret).join('[redacted]');
}
