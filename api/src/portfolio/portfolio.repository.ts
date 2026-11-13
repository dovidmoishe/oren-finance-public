import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, or } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import {
  agentMessages,
  agentThreads,
  executions,
  portfolioSnapshots,
  vaultPositions,
} from '../database/schema';

export type SnapshotRow = typeof portfolioSnapshots.$inferSelect;
export type VaultPositionRow = typeof vaultPositions.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;
export type AgentMessageRow = typeof agentMessages.$inferSelect;

export interface InsertSnapshotInput {
  walletAddress: string;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  positionsJson: unknown;
}

@Injectable()
export class PortfolioRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insertSnapshot(input: InsertSnapshotInput): Promise<SnapshotRow> {
    const [row] = await this.db
      .insert(portfolioSnapshots)
      .values({
        walletAddress: input.walletAddress,
        totalValueUsd: String(input.totalValueUsd),
        availableValueUsd: String(input.availableValueUsd),
        lockedValueUsd: String(input.lockedValueUsd),
        positionsJson: input.positionsJson ?? [],
      })
      .returning();
    return row;
  }

  async listSnapshots(
    walletAddress: string,
    limit = 500,
  ): Promise<SnapshotRow[]> {
    return this.db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.walletAddress, walletAddress))
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(limit);
  }

  async listSnapshotsInRange(
    walletAddress: string,
    start: Date,
    end: Date,
  ): Promise<SnapshotRow[]> {
    return this.db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.walletAddress, walletAddress),
          gte(portfolioSnapshots.timestamp, start),
          lt(portfolioSnapshots.timestamp, end),
        ),
      )
      .orderBy(portfolioSnapshots.timestamp);
  }

  async getSnapshotBefore(
    walletAddress: string,
    before: Date,
  ): Promise<SnapshotRow | null> {
    const rows = await this.db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.walletAddress, walletAddress),
          lt(portfolioSnapshots.timestamp, before),
        ),
      )
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(1);
    return rows[0] ?? null;
  }

  async getLatestSnapshot(
    walletAddress: string,
  ): Promise<SnapshotRow | null> {
    const rows = await this.listSnapshots(walletAddress, 1);
    return rows[0] ?? null;
  }

  async listVaultPositions(owner: string): Promise<VaultPositionRow[]> {
    return this.db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.owner, owner));
  }

  async listExecutions(
    walletAddress: string,
    limit = 50,
  ): Promise<ExecutionRow[]> {
    return this.db
      .select()
      .from(executions)
      .where(eq(executions.walletAddress, walletAddress))
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }

  async listExecutionsInRange(
    walletAddress: string,
    start: Date,
    end: Date,
  ): Promise<ExecutionRow[]> {
    return this.db
      .select()
      .from(executions)
      .where(
        and(
          eq(executions.walletAddress, walletAddress),
          gte(executions.createdAt, start),
          lt(executions.createdAt, end),
        ),
      )
      .orderBy(executions.createdAt);
  }

  async listVaultPositionsInRange(
    owner: string,
    start: Date,
    end: Date,
  ): Promise<VaultPositionRow[]> {
    return this.db
      .select()
      .from(vaultPositions)
      .where(
        and(
          eq(vaultPositions.owner, owner),
          or(
            and(
              gte(vaultPositions.createdAt, start),
              lt(vaultPositions.createdAt, end),
            ),
            and(
              gte(vaultPositions.unlockAt, start),
              lt(vaultPositions.unlockAt, end),
            ),
          ),
        ),
      )
      .orderBy(vaultPositions.createdAt);
  }

  async listAgentToolMessagesInRange(
    walletAddress: string,
    start: Date,
    end: Date,
  ): Promise<AgentMessageRow[]> {
    const rows = await this.db
      .select({ message: agentMessages })
      .from(agentMessages)
      .innerJoin(agentThreads, eq(agentMessages.threadId, agentThreads.id))
      .where(
        and(
          eq(agentThreads.walletAddress, walletAddress),
          eq(agentMessages.role, 'tool'),
          gte(agentMessages.createdAt, start),
          lt(agentMessages.createdAt, end),
        ),
      )
      .orderBy(agentMessages.createdAt);
    return rows.map((row) => row.message);
  }
}
