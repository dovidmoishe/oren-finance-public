import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, or } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { executionJobs, executions } from '../database/schema';
import type {
  ExecutionFeature,
  ExecutionStatus,
  ExecutionType,
} from '../../types/execution';

export type ExecutionRow = typeof executions.$inferSelect;

export interface InsertExecutionInput {
  walletAddress: string;
  type: ExecutionType;
  assetId?: string;
  ticker?: string;
  tokenMint?: string;
  inputAsset?: string;
  outputAsset?: string;
  amount?: number;
  amountUsd?: number;
  provider?: string;
  featureSource?: ExecutionFeature;
  status: ExecutionStatus;
  transactionSignature?: string;
}

@Injectable()
export class ExecutionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(input: InsertExecutionInput): Promise<ExecutionRow> {
    const [row] = await this.db
      .insert(executions)
      .values({
        walletAddress: input.walletAddress,
        type: input.type,
        assetId: input.assetId,
        ticker: input.ticker,
        tokenMint: input.tokenMint,
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        amount: input.amount !== undefined ? String(input.amount) : undefined,
        amountUsd:
          input.amountUsd !== undefined ? String(input.amountUsd) : undefined,
        provider: input.provider,
        featureSource: input.featureSource ?? 'direct',
        status: input.status,
        transactionSignature: input.transactionSignature,
      })
      .returning();
    return row;
  }

  async submitAndEnqueue(input: {
    executionId: string;
    walletAddress: string;
    transactionSignature: string;
  }): Promise<ExecutionRow | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(executions)
        .set({
          status: 'submitted',
          transactionSignature: input.transactionSignature,
          submittedAt: new Date(),
        })
        .where(
          and(
            eq(executions.id, input.executionId),
            eq(executions.walletAddress, input.walletAddress),
            // A submitted execution may be re-confirmed with the same
            // signature (approval retries), never re-pointed at another one.
            or(
              eq(executions.status, 'awaiting_signature'),
              and(
                eq(executions.status, 'submitted'),
                eq(executions.transactionSignature, input.transactionSignature),
              ),
            ),
          ),
        )
        .returning();
      if (!row) return null;

      await tx
        .insert(executionJobs)
        .values({
          kind: 'swap_fill',
          dedupeKey: `swap:${input.transactionSignature}`,
          executionId: row.id,
          transactionSignature: input.transactionSignature,
          status: 'pending',
        })
        .onConflictDoNothing({ target: executionJobs.dedupeKey });
      return row;
    });
  }

  async updateStatus(
    id: string,
    patch: {
      status: ExecutionStatus;
      transactionSignature?: string;
    },
  ): Promise<ExecutionRow | null> {
    const [row] = await this.db
      .update(executions)
      .set({
        status: patch.status,
        ...(patch.transactionSignature !== undefined
          ? { transactionSignature: patch.transactionSignature }
          : {}),
      })
      .where(eq(executions.id, id))
      .returning();
    return row ?? null;
  }

  async findById(id: string): Promise<ExecutionRow | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findLatestAwaitingSignature(
    walletAddress: string,
  ): Promise<ExecutionRow | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.walletAddress, walletAddress),
          eq(executions.status, 'awaiting_signature'),
        ),
      )
      .orderBy(desc(executions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async findBySignature(signature: string): Promise<ExecutionRow | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.transactionSignature, signature))
      .limit(1);
    return rows[0] ?? null;
  }
}
