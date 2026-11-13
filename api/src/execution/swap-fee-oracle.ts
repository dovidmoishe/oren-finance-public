import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { JupiterGateway } from './jupiter/jupiter-gateway';
import { NATIVE_SOL_MINT } from './swap-balance-guard';
import {
  MIN_PRIORITY_MICRO_LAMPORTS,
  percentile,
  PRIORITY_FEE_PERCENTILE,
} from './titan/titan-tx.builder';

/** How long a live SOL price / priority fee is reused. */
export const FEE_ORACLE_TTL_MS = 45_000;
/** Best-mode quotes never wait longer than this for fee inputs. */
export const FEE_ORACLE_TIMEOUT_MS = 1_500;
/** Reject obviously broken SOL prices instead of trusting them. */
const SOL_USD_MIN = 1;
const SOL_USD_MAX = 100_000;

/** Live inputs for converting a network-fee difference into bps. */
export interface FeeSnapshot {
  solUsd: number;
  /** Current priority price (µ-lamports per CU), network-wide p75. */
  priorityMicroLamports: number;
}

interface Cached<T> {
  value: T;
  at: number;
}

export interface SwapFeeOracleOptions {
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Live SOL/USD (Jupiter Price API v3, through the shared JupiterGateway on
 * the background lane so it never takes budget from user swaps) and the live
 * priority-fee level (RPC getRecentPrioritizationFees), each cached ~45 s.
 *
 * `snapshot()` resolves `undefined` when either input is unavailable,
 * stale, or slower than FEE_ORACLE_TIMEOUT_MS. Callers must then fail safe
 * (best mode keeps Jupiter). No hardcoded fallback price is ever used.
 */
@Injectable()
export class SwapFeeOracle {
  private readonly logger = new Logger(SwapFeeOracle.name);
  private readonly priceUrl: string;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private sol?: Cached<number>;
  private priority?: Cached<number>;
  private solInFlight?: Promise<number | undefined>;
  private priorityInFlight?: Promise<number | undefined>;

  constructor(
    private readonly gateway: JupiterGateway,
    private readonly rpc: AlchemyClient,
    @Inject(APP_ENV) env: Pick<AppEnv, 'JUPITER_API_URL'>,
    @Optional() options?: SwapFeeOracleOptions,
  ) {
    this.priceUrl = jupiterPriceUrl(env.JUPITER_API_URL);
    this.now = options?.now ?? Date.now;
    this.timeoutMs = options?.timeoutMs ?? FEE_ORACLE_TIMEOUT_MS;
  }

  async snapshot(): Promise<FeeSnapshot | undefined> {
    const [solUsd, priorityMicroLamports] = await Promise.all([
      this.solUsd(),
      this.priorityMicroLamports(),
    ]);
    if (solUsd === undefined || priorityMicroLamports === undefined) {
      return undefined;
    }
    return { solUsd, priorityMicroLamports };
  }

  /** Live SOL/USD or undefined. Never a constant. */
  solUsd(): Promise<number | undefined> {
    if (this.fresh(this.sol)) return Promise.resolve(this.sol!.value);
    this.solInFlight ??= this.fetchSolUsd().finally(() => {
      this.solInFlight = undefined;
    });
    return this.withTimeout(this.solInFlight, 'SOL price');
  }

  priorityMicroLamports(): Promise<number | undefined> {
    if (this.fresh(this.priority)) {
      return Promise.resolve(this.priority!.value);
    }
    this.priorityInFlight ??= this.fetchPriority().finally(() => {
      this.priorityInFlight = undefined;
    });
    return this.withTimeout(this.priorityInFlight, 'priority fee');
  }

  private fresh(entry: Cached<number> | undefined): boolean {
    return Boolean(entry && this.now() - entry.at < FEE_ORACLE_TTL_MS);
  }

  private async fetchSolUsd(): Promise<number | undefined> {
    try {
      const url = `${this.priceUrl}?ids=${NATIVE_SOL_MINT}`;
      const response = await this.gateway.fetch(
        url,
        { method: 'GET', headers: { Accept: 'application/json' } },
        'Jupiter price',
        'background',
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as Record<
        string,
        { usdPrice?: unknown } | undefined
      >;
      const price = Number(body?.[NATIVE_SOL_MINT]?.usdPrice);
      if (
        !Number.isFinite(price) ||
        price < SOL_USD_MIN ||
        price > SOL_USD_MAX
      ) {
        throw new Error(`implausible SOL price ${String(price)}`);
      }
      this.sol = { value: price, at: this.now() };
      return price;
    } catch (err) {
      this.logger.warn(`Live SOL price unavailable: ${errorMessage(err)}`);
      return undefined;
    }
  }

  private async fetchPriority(): Promise<number | undefined> {
    try {
      const rows = await this.rpc.call<
        { slot: number; prioritizationFee: number }[]
      >('getRecentPrioritizationFees', [[]]);
      const fees = (rows ?? [])
        .map((row) => Number(row.prioritizationFee))
        .filter((fee) => Number.isFinite(fee) && fee >= 0);
      if (fees.length === 0) throw new Error('no samples');
      const value = Math.max(
        MIN_PRIORITY_MICRO_LAMPORTS,
        Math.ceil(percentile(fees, PRIORITY_FEE_PERCENTILE)),
      );
      this.priority = { value, at: this.now() };
      return value;
    } catch (err) {
      this.logger.warn(`Live priority fee unavailable: ${errorMessage(err)}`);
      return undefined;
    }
  }

  private async withTimeout(
    pending: Promise<number | undefined>,
    label: string,
  ): Promise<number | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`${label} slower than ${this.timeoutMs}ms; skipping`);
        resolve(undefined);
      }, this.timeoutMs);
    });
    try {
      // The fetch keeps running and fills the cache for the next quote.
      return await Promise.race([pending, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** api.jup.ag/swap/v1 → api.jup.ag/price/v3 (same host, same key). */
export function jupiterPriceUrl(jupiterApiUrl: string | undefined): string {
  try {
    return `${new URL(jupiterApiUrl ?? 'https://api.jup.ag').origin}/price/v3`;
  } catch {
    return 'https://api.jup.ag/price/v3';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
