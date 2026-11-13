import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BitgetMarketContext } from '../../types/bitget';
import type { ChartRange } from '../../types/market';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import {
  mapBitgetCandles,
  mapBitgetQuote,
  mapBitgetSessions,
} from './bitget.mapper';
import type {
  BitgetApiEnvelope,
  BitgetCandleRaw,
  BitgetMarketStateRaw,
  BitgetRealityStockRaw,
  BitgetTickerRaw,
} from './bitget.types';

const DIRECTORY_FRESH_MS = 6 * 60 * 60 * 1000;
const DIRECTORY_STALE_MS = 24 * 60 * 60 * 1000;
const CONTEXT_FRESH_MS = 15 * 1000;
const CONTEXT_STALE_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

interface RealityInstrument {
  symbol: string;
  ticker: string;
  name?: string;
  tradingPeriods: string[];
  weekendTradable: boolean;
}

@Injectable()
export class BitgetService {
  private readonly logger = new Logger(BitgetService.name);
  private readonly instrumentCache = new Map<
    string,
    CacheEntry<RealityInstrument | null>
  >();
  private readonly instrumentInflight = new Map<
    string,
    Promise<RealityInstrument | null>
  >();
  private readonly contextCache = new Map<
    string,
    CacheEntry<BitgetMarketContext>
  >();
  private readonly contextInflight = new Map<
    string,
    Promise<BitgetMarketContext>
  >();

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}

  async getMarketContext(input: {
    assetId: string;
    ticker: string;
    referencePriceUsd?: number;
    range?: ChartRange;
  }): Promise<BitgetMarketContext> {
    const range = input.range ?? '1D';
    const ticker = input.ticker.trim().toUpperCase();
    const cacheKey = `${ticker}:${range}`;
    const cached = this.contextCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt < CONTEXT_FRESH_MS) {
      return withReferencePrice(cached.value, input.referencePriceUsd);
    }

    const inflight = this.contextInflight.get(cacheKey);
    if (inflight)
      return withReferencePrice(await inflight, input.referencePriceUsd);

    const request = this.fetchMarketContext(input.assetId, ticker, range)
      .then((value) => {
        this.contextCache.set(cacheKey, { value, storedAt: Date.now() });
        return value;
      })
      .catch((error: unknown) => {
        if (cached && Date.now() - cached.storedAt < CONTEXT_STALE_MS) {
          this.logger.warn(
            `Using stale Bitget context for ${ticker}: ${errorMessage(error)}`,
          );
          return {
            ...cached.value,
            warnings: unique([
              ...(cached.value.warnings ?? []),
              'Live Bitget refresh failed; using recent cached data.',
            ]),
            source: { ...cached.value.source, stale: true },
          };
        }
        this.logger.warn(
          `Bitget context unavailable for ${ticker}: ${errorMessage(error)}`,
        );
        return unavailableContext(
          input.assetId,
          ticker,
          range,
          'BITGET_UNAVAILABLE',
          ['Bitget did not respond within the live research budget.'],
        );
      })
      .finally(() => this.contextInflight.delete(cacheKey));

    this.contextInflight.set(cacheKey, request);
    return withReferencePrice(await request, input.referencePriceUsd);
  }

  private async fetchMarketContext(
    assetId: string,
    ticker: string,
    range: ChartRange,
  ): Promise<BitgetMarketContext> {
    const candidateSymbol = realitySymbol(ticker);
    const [instrumentResult, tickerResult, candlesResult, statesResult] =
      await Promise.allSettled([
        this.resolveRealityInstrument(ticker),
        this.getTicker(candidateSymbol),
        this.getCandles(candidateSymbol, range),
        this.getMarketStates(),
      ]);
    const warnings: string[] = [];
    const instrument =
      instrumentResult.status === 'fulfilled'
        ? instrumentResult.value
        : undefined;
    const quote =
      tickerResult.status === 'fulfilled'
        ? tickerResult.value.quote
        : undefined;
    const observedAt =
      tickerResult.status === 'fulfilled'
        ? tickerResult.value.observedAt
        : new Date();
    const candles =
      candlesResult.status === 'fulfilled' ? candlesResult.value : [];
    const sessions =
      statesResult.status === 'fulfilled'
        ? mapBitgetSessions(statesResult.value)
        : { sessions: [] };

    if (tickerResult.status === 'rejected')
      warnings.push('Bitget ticker unavailable.');
    if (candlesResult.status === 'rejected')
      warnings.push('Bitget candles unavailable.');
    if (statesResult.status === 'rejected')
      warnings.push('Bitget market sessions unavailable.');
    if (instrumentResult.status === 'rejected')
      warnings.push('Bitget Reality reference metadata unavailable.');
    if (!quote && candles.length === 0) {
      if (instrumentResult.status === 'fulfilled' && instrument === null) {
        return unavailableContext(
          assetId,
          ticker,
          range,
          'BITGET_REALITY_SYMBOL_UNAVAILABLE',
          warnings.length ? warnings : undefined,
        );
      }
      throw new Error(
        warnings.join(' ') || 'Bitget returned no usable market data',
      );
    }

    return {
      available: true,
      assetId,
      ticker,
      symbol: instrument?.symbol ?? candidateSymbol,
      range,
      quote,
      candles,
      trading: {
        supportedPeriods: instrument?.tradingPeriods ?? [],
        weekendTradable: instrument?.weekendTradable ?? false,
        daylightType: sessions.daylightType,
        sessions: sessions.sessions,
      },
      warnings: warnings.length ? warnings : undefined,
      source: {
        provider: 'Bitget',
        product: 'Reality',
        observedAt,
        stale: false,
      },
    };
  }

  private async resolveRealityInstrument(
    ticker: string,
  ): Promise<RealityInstrument | null> {
    const cached = this.instrumentCache.get(ticker);
    if (cached && Date.now() - cached.storedAt < DIRECTORY_FRESH_MS) {
      return cached.value;
    }
    const inflight = this.instrumentInflight.get(ticker);
    if (inflight) return inflight;

    const candidateSymbol = realitySymbol(ticker);
    const request = this.request<BitgetRealityStockRaw[]>(
      '/api/v3/reality/market/stock-info',
      { symbol: candidateSymbol },
    )
      .then((rows) => {
        const row =
          rows.find((item) => item.code?.trim().toUpperCase() === ticker) ??
          rows[0];
        const symbol = row?.symbol?.trim().toUpperCase();
        const code = row?.code?.trim().toUpperCase();
        const periods = Array.isArray(row?.tradingPeriod)
          ? row.tradingPeriod
          : row?.tradingPeriod
            ? [row.tradingPeriod]
            : [];
        const instrument =
          symbol && code === ticker
            ? {
                ticker,
                symbol,
                name: row?.name,
                tradingPeriods: periods,
                weekendTradable: row?.weekendTradable?.toLowerCase() === 'yes',
              }
            : null;
        this.instrumentCache.set(ticker, {
          value: instrument,
          storedAt: Date.now(),
        });
        return instrument;
      })
      .catch((error: unknown) => {
        if (cached && Date.now() - cached.storedAt < DIRECTORY_STALE_MS) {
          this.logger.warn(
            `Using stale Bitget Reality instrument for ${ticker}: ${errorMessage(error)}`,
          );
          return cached.value;
        }
        throw error;
      })
      .finally(() => {
        this.instrumentInflight.delete(ticker);
      });
    this.instrumentInflight.set(ticker, request);
    return request;
  }

  private async getTicker(
    symbol: string,
  ): Promise<{ quote: ReturnType<typeof mapBitgetQuote>; observedAt: Date }> {
    const envelope = await this.requestEnvelope<BitgetTickerRaw[]>(
      '/api/v3/market/tickers',
      { category: 'SPOT', symbol },
    );
    const raw =
      envelope.data?.find((item) => item.symbol?.toUpperCase() === symbol) ??
      envelope.data?.[0];
    const quote = raw ? mapBitgetQuote(raw) : undefined;
    if (!quote)
      throw new Error(`Bitget returned no valid ticker for ${symbol}`);
    const timestamp = Number(raw?.ts ?? envelope.requestTime ?? Date.now());
    return {
      quote,
      observedAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()),
    };
  }

  private async getCandles(symbol: string, range: ChartRange) {
    const window = candleWindow(range);
    const endpoint =
      range === '1Y' || range === 'ALL'
        ? '/api/v3/market/history-candles'
        : '/api/v3/market/candles';
    const rows = await this.request<BitgetCandleRaw[]>(endpoint, {
      category: 'SPOT',
      symbol,
      interval: window.interval,
      startTime: String(Date.now() - window.durationMs),
      endTime: String(Date.now()),
      type: 'market',
      limit: String(window.limit),
    });
    return mapBitgetCandles(rows);
  }

  private getMarketStates() {
    return this.request<BitgetMarketStateRaw[]>(
      '/api/v3/reality/market/states',
    );
  }

  private async request<T>(
    path: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const envelope = await this.requestEnvelope<T>(path, query);
    if (envelope.data === undefined)
      throw new Error(`Bitget returned no data for ${path}`);
    return envelope.data;
  }

  private async requestEnvelope<T>(
    path: string,
    query?: Record<string, string>,
  ): Promise<BitgetApiEnvelope<T>> {
    const url = new URL(`${this.env.BITGET_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.env.BITGET_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Bitget HTTP ${response.status}`);
      const envelope = (await response.json()) as BitgetApiEnvelope<T>;
      if (envelope.code !== '00000') {
        throw new Error(
          `Bitget ${envelope.code ?? 'error'}: ${envelope.msg ?? 'request failed'}`,
        );
      }
      return envelope;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Bitget request timed out after ${this.env.BITGET_REQUEST_TIMEOUT_MS}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function unavailableContext(
  assetId: string,
  ticker: string,
  range: ChartRange,
  reason: BitgetMarketContext['reason'],
  warnings?: string[],
): BitgetMarketContext {
  return {
    available: false,
    assetId,
    ticker,
    range,
    candles: [],
    reason,
    warnings,
    source: {
      provider: 'Bitget',
      product: 'Reality',
      observedAt: new Date(),
      stale: false,
    },
  };
}

function withReferencePrice(
  context: BitgetMarketContext,
  referencePriceUsd?: number,
): BitgetMarketContext {
  if (!context.quote || !referencePriceUsd || referencePriceUsd <= 0)
    return context;
  return {
    ...context,
    comparison: {
      orenReferencePriceUsd: referencePriceUsd,
      bitgetPriceUsd: context.quote.lastPriceUsd,
      differencePct:
        Math.round(
          ((context.quote.lastPriceUsd - referencePriceUsd) /
            referencePriceUsd) *
            100 *
            10_000,
        ) / 10_000,
    },
  };
}

function candleWindow(range: ChartRange): {
  interval: string;
  durationMs: number;
  limit: number;
} {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case '1D':
      return { interval: '5m', durationMs: day, limit: 300 };
    case '1W':
      return { interval: '1H', durationMs: 7 * day, limit: 200 };
    case '1M':
      return { interval: '4H', durationMs: 31 * day, limit: 200 };
    case '3M':
      return { interval: '1D', durationMs: 93 * day, limit: 100 };
    case '1Y':
      return { interval: '1D', durationMs: 366 * day, limit: 366 };
    case 'ALL':
      return { interval: '1D', durationMs: 1_000 * day, limit: 1_000 };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function realitySymbol(ticker: string): string {
  return `R${ticker.replace(/[^A-Z0-9]/g, '')}USDT`;
}
