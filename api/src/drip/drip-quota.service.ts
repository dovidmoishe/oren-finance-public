import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { researchUsage } from '../database/schema';

/** Atomic database counters work across API replicas. */
@Injectable()
export class DripQuotaService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async claim(userId: string): Promise<boolean> {
    const now = Date.now();
    const day = new Date(Math.floor(now / 86_400_000) * 86_400_000);
    const minute = new Date(Math.floor(now / 60_000) * 60_000);
    const date = new Date(now);
    const month = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    );
    const user = await this.increment(`user:${userId}`, day, 60);
    if (!user) return false;
    if (!(await this.increment('drip:minute', minute, 30))) return false;
    return this.increment('drip:month', month, 80_000);
  }

  private async increment(
    bucket: string,
    windowStart: Date,
    limit: number,
  ): Promise<boolean> {
    const rows = await this.db
      .insert(researchUsage)
      .values({ bucket, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [researchUsage.bucket, researchUsage.windowStart],
        set: { count: sql`${researchUsage.count} + 1` },
        setWhere: sql`${researchUsage.count} < ${limit}`,
      })
      .returning({ count: researchUsage.count });
    return rows.length === 1;
  }
}
