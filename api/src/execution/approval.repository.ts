import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { tradeApprovals } from '../database/schema';

export type ApprovalRow = typeof tradeApprovals.$inferSelect;
@Injectable()
export class ApprovalRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}
  async findReference(
    userId: string,
    wallet: string,
    kind: string,
    referenceId: string,
  ) {
    return (
      await this.db
        .select()
        .from(tradeApprovals)
        .where(
          and(
            eq(tradeApprovals.userId, userId),
            eq(tradeApprovals.wallet, wallet),
            eq(tradeApprovals.kind, kind),
            eq(tradeApprovals.referenceId, referenceId),
          ),
        )
        .limit(1)
    )[0];
  }
  async get(id: string) {
    return (
      await this.db
        .select()
        .from(tradeApprovals)
        .where(eq(tradeApprovals.id, id))
        .limit(1)
    )[0];
  }
  async create(input: typeof tradeApprovals.$inferInsert) {
    await this.db
      .insert(tradeApprovals)
      .values(input)
      .onConflictDoUpdate({
        target: [
          tradeApprovals.userId,
          tradeApprovals.wallet,
          tradeApprovals.kind,
          tradeApprovals.referenceId,
        ],
        // A fresh review gets a fresh idempotency key. Never replace an uncertain submission.
        set: {
          ...input,
          id: sql`gen_random_uuid()`,
          status: 'prepared',
          signedTransaction: null,
          signature: null,
          createdAt: new Date(),
        },
        setWhere: sql`${tradeApprovals.status} = 'failed' OR (${tradeApprovals.status} = 'prepared' AND ${tradeApprovals.expiresAt} <= now())`,
      });
    return (
      await this.db
        .select()
        .from(tradeApprovals)
        .where(
          and(
            eq(tradeApprovals.userId, input.userId),
            eq(tradeApprovals.wallet, input.wallet),
            eq(tradeApprovals.kind, input.kind),
            eq(tradeApprovals.referenceId, input.referenceId),
          ),
        )
        .limit(1)
    )[0];
  }
  async pending(userId: string, wallet: string) {
    return this.db
      .select()
      .from(tradeApprovals)
      .where(
        and(
          eq(tradeApprovals.userId, userId),
          eq(tradeApprovals.wallet, wallet),
          inArray(tradeApprovals.status, ['signing', 'signed', 'submitted']),
        ),
      )
      .limit(20);
  }
  async claim(id: string) {
    try {
      return (
        await this.db
          .update(tradeApprovals)
          .set({ status: 'signing' })
          .where(
            and(
              eq(tradeApprovals.id, id),
              eq(tradeApprovals.status, 'prepared'),
            ),
          )
          .returning()
      )[0];
    } catch (error) {
      if (
        (error as { cause?: { code?: string }; code?: string }).cause?.code ===
          '23505' ||
        (error as { code?: string }).code === '23505'
      )
        return undefined;
      throw error;
    }
  }
  async patch(
    id: string,
    values: Partial<
      Pick<ApprovalRow, 'status' | 'signedTransaction' | 'signature'>
    >,
    expectedStatus?: string,
  ) {
    return (
      await this.db
        .update(tradeApprovals)
        .set(values)
        .where(
          and(
            eq(tradeApprovals.id, id),
            expectedStatus
              ? eq(tradeApprovals.status, expectedStatus)
              : undefined,
            values.status === 'signed'
              ? sql`${tradeApprovals.expiresAt} > now()`
              : undefined,
          ),
        )
        .returning()
    )[0];
  }
}
