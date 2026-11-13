import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { executionJobs, executions, tradeFills } from '../database/schema';
import type {
  FeatureVolume,
  StockVolume,
  VerifiedTradeFill,
  VolumeInterval,
  VolumePoint,
  VolumeRange,
  VolumeTotals,
} from '../../types/volume';

export type ExecutionJobRow = typeof executionJobs.$inferSelect;

@Injectable()
export class VolumeRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async claimJobs(limit = 25): Promise<ExecutionJobRow[]> {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    await this.db
      .update(executionJobs)
      .set({ status: 'retry', lockedAt: null })
      .where(
        and(
          eq(executionJobs.status, 'processing'),
          lt(executionJobs.lockedAt, staleBefore),
        ),
      );

    const candidates = await this.db
      .select()
      .from(executionJobs)
      .where(
        and(
          inArray(executionJobs.status, ['pending', 'retry']),
          lte(executionJobs.availableAt, new Date()),
          or(isNull(executionJobs.lockedAt), lt(executionJobs.lockedAt, staleBefore)),
          inArray(executionJobs.kind, ['swap_fill', 'limit_fill']),
        ),
      )
      .orderBy(asc(executionJobs.availableAt))
      .limit(limit);

    const claimed: ExecutionJobRow[] = [];
    for (const candidate of candidates) {
      const [row] = await this.db
        .update(executionJobs)
        .set({
          status: 'processing',
          lockedAt: new Date(),
          attempts: candidate.attempts + 1,
        })
        .where(
          and(
            eq(executionJobs.id, candidate.id),
            inArray(executionJobs.status, ['pending', 'retry']),
          ),
        )
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async claimDuneJobs(limit = 200): Promise<ExecutionJobRow[]> {
    const candidates = await this.db
      .select()
      .from(executionJobs)
      .where(
        and(
          inArray(executionJobs.status, ['pending', 'retry']),
          eq(executionJobs.kind, 'dune_sync'),
          lte(executionJobs.availableAt, new Date()),
        ),
      )
      .orderBy(asc(executionJobs.availableAt))
      .limit(limit);
    const claimed: ExecutionJobRow[] = [];
    for (const candidate of candidates) {
      const [row] = await this.db
        .update(executionJobs)
        .set({ status: 'processing', lockedAt: new Date(), attempts: candidate.attempts + 1 })
        .where(
          and(
            eq(executionJobs.id, candidate.id),
            inArray(executionJobs.status, ['pending', 'retry']),
          ),
        )
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async publicFills(signatures: string[]) {
    if (!signatures.length) return [];
    return this.db
      .select({
        transactionSignature: tradeFills.transactionSignature,
        fillIndex: tradeFills.fillIndex,
        assetId: tradeFills.assetId,
        ticker: tradeFills.ticker,
        tokenMint: tradeFills.tokenMint,
        side: tradeFills.side,
        stockAmount: tradeFills.stockAmount,
        usdNotional: tradeFills.usdNotional,
        featureSource: tradeFills.featureSource,
        slot: tradeFills.slot,
        blockTime: tradeFills.blockTime,
      })
      .from(tradeFills)
      .where(inArray(tradeFills.transactionSignature, signatures));
  }

  async completeJobs(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(executionJobs)
      .set({ status: 'completed', completedAt: new Date(), lockedAt: null })
      .where(inArray(executionJobs.id, ids));
  }

  async retryJobs(jobs: ExecutionJobRow[], error: string): Promise<void> {
    await Promise.all(jobs.map((job) => this.retry(job, error)));
  }

  findExecution(id: string) {
    return this.db.query.executions.findFirst({ where: eq(executions.id, id) });
  }

  async enqueueLimitFill(input: {
    executionId: string;
    orderKey: string;
    transactionSignature: string;
  }): Promise<void> {
    await this.db
      .insert(executionJobs)
      .values({
        kind: 'limit_fill',
        dedupeKey: `limit:${input.orderKey}:${input.transactionSignature}`,
        executionId: input.executionId,
        orderKey: input.orderKey,
        transactionSignature: input.transactionSignature,
        status: 'pending',
      })
      .onConflictDoNothing({ target: executionJobs.dedupeKey });
  }

  async completeFill(jobId: string, fill: VerifiedTradeFill): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(tradeFills)
        .values({
          executionId: fill.executionId,
          transactionSignature: fill.transactionSignature,
          fillIndex: fill.fillIndex,
          walletAddress: fill.walletAddress,
          assetId: fill.assetId,
          ticker: fill.ticker,
          tokenMint: fill.tokenMint,
          side: fill.side,
          stockAmount: String(fill.stockAmount),
          usdNotional: String(fill.usdNotional),
          executionPriceUsd: String(fill.executionPriceUsd),
          featureSource: fill.featureSource,
          provider: fill.provider,
          slot: String(fill.slot),
          blockTime: fill.blockTime,
        })
        .onConflictDoNothing();

      await tx
        .update(executions)
        .set({ status: 'confirmed' })
        .where(eq(executions.id, fill.executionId));
      await tx
        .update(executionJobs)
        .set({ status: 'completed', completedAt: new Date(), lockedAt: null })
        .where(eq(executionJobs.id, jobId));
      await tx
        .insert(executionJobs)
        .values({
          kind: 'dune_sync',
          dedupeKey: `dune:${fill.transactionSignature}:${fill.assetId}:${fill.fillIndex}`,
          executionId: fill.executionId,
          transactionSignature: fill.transactionSignature,
          status: 'pending',
        })
        .onConflictDoNothing({ target: executionJobs.dedupeKey });
    });
  }

  async completeFailedTransaction(job: ExecutionJobRow): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (job.executionId) {
        await tx
          .update(executions)
          .set({ status: 'failed' })
          .where(eq(executions.id, job.executionId));
      }
      await tx
        .update(executionJobs)
        .set({ status: 'completed', completedAt: new Date(), lockedAt: null })
        .where(eq(executionJobs.id, job.id));
    });
  }

  async retry(job: ExecutionJobRow, error: string): Promise<void> {
    const dead = job.attempts >= 20;
    const delayMs = Math.min(60 * 60_000, 5_000 * 3 ** Math.max(0, job.attempts - 1));
    await this.db
      .update(executionJobs)
      .set({
        status: dead ? 'dead' : 'retry',
        lockedAt: null,
        lastError: error.slice(0, 2_000),
        availableAt: new Date(Date.now() + delayMs),
      })
      .where(eq(executionJobs.id, job.id));
  }

  async deadJobCount(): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(executionJobs)
      .where(eq(executionJobs.status, 'dead'));
    return Number(row?.value ?? 0);
  }

  async totals(range: VolumeRange, assetId?: string): Promise<VolumeTotals> {
    const where = this.rangeWhere(range, assetId);
    const [row] = await this.db
      .select({
        gross: sql<string>`coalesce(sum(${tradeFills.usdNotional}), 0)`,
        buys: sql<string>`coalesce(sum(case when ${tradeFills.side} = 'buy' then ${tradeFills.usdNotional} else 0 end), 0)`,
        sells: sql<string>`coalesce(sum(case when ${tradeFills.side} = 'sell' then ${tradeFills.usdNotional} else 0 end), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tradeFills)
      .where(where);
    return toTotals(row);
  }

  async timeSeries(range: VolumeRange, interval: VolumeInterval): Promise<VolumePoint[]> {
    const bucket = interval === 'hour'
      ? sql<Date>`date_trunc('hour', ${tradeFills.blockTime})`
      : sql<Date>`date_trunc('day', ${tradeFills.blockTime})`;
    const rows = await this.db
      .select({
        bucket,
        gross: sql<string>`sum(${tradeFills.usdNotional})`,
        buys: sql<string>`sum(case when ${tradeFills.side} = 'buy' then ${tradeFills.usdNotional} else 0 end)`,
        sells: sql<string>`sum(case when ${tradeFills.side} = 'sell' then ${tradeFills.usdNotional} else 0 end)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tradeFills)
      .where(this.rangeWhere(range))
      .groupBy(bucket)
      .orderBy(bucket);
    return rows.map((row) => ({
      timestamp: new Date(row.bucket).toISOString(),
      ...toTotals(row),
    }));
  }

  async stocks(range: VolumeRange): Promise<StockVolume[]> {
    const rows = await this.db
      .select({
        assetId: tradeFills.assetId,
        ticker: tradeFills.ticker,
        gross: sql<string>`sum(${tradeFills.usdNotional})`,
        buys: sql<string>`sum(case when ${tradeFills.side} = 'buy' then ${tradeFills.usdNotional} else 0 end)`,
        sells: sql<string>`sum(case when ${tradeFills.side} = 'sell' then ${tradeFills.usdNotional} else 0 end)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tradeFills)
      .where(this.rangeWhere(range))
      .groupBy(tradeFills.assetId, tradeFills.ticker)
      .orderBy(sql`sum(${tradeFills.usdNotional}) desc`);
    return rows.map((row) => ({ assetId: row.assetId, ticker: row.ticker, ...toTotals(row) }));
  }

  async features(range: VolumeRange): Promise<FeatureVolume[]> {
    const rows = await this.db
      .select({
        feature: tradeFills.featureSource,
        gross: sql<string>`sum(${tradeFills.usdNotional})`,
        buys: sql<string>`sum(case when ${tradeFills.side} = 'buy' then ${tradeFills.usdNotional} else 0 end)`,
        sells: sql<string>`sum(case when ${tradeFills.side} = 'sell' then ${tradeFills.usdNotional} else 0 end)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tradeFills)
      .where(this.rangeWhere(range))
      .groupBy(tradeFills.featureSource)
      .orderBy(sql`sum(${tradeFills.usdNotional}) desc`);
    return rows.map((row) => ({ feature: row.feature, ...toTotals(row) }));
  }

  private rangeWhere(range: VolumeRange, assetId?: string) {
    const start = rangeStart(range);
    const time = start ? gte(tradeFills.blockTime, start) : undefined;
    const asset = assetId ? eq(tradeFills.assetId, assetId) : undefined;
    return time && asset ? and(time, asset) : time ?? asset;
  }
}

function rangeStart(range: VolumeRange): Date | undefined {
  const duration = range === '24h' ? 86_400_000 : range === '7d' ? 604_800_000 : range === '30d' ? 2_592_000_000 : 0;
  return duration ? new Date(Date.now() - duration) : undefined;
}

function toTotals(row?: { gross: string | number; buys: string | number; sells: string | number; count: number }): VolumeTotals {
  const buyVolumeUsd = Number(row?.buys ?? 0);
  const sellVolumeUsd = Number(row?.sells ?? 0);
  return {
    grossVolumeUsd: Number(row?.gross ?? 0),
    buyVolumeUsd,
    sellVolumeUsd,
    netFlowUsd: buyVolumeUsd - sellVolumeUsd,
    tradeCount: Number(row?.count ?? 0),
  };
}
