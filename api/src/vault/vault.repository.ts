import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { ConfirmLockRequest, VaultPosition } from '../../types/vault';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { executions, vaultPositions } from '../database/schema';

export type VaultPositionRow = typeof vaultPositions.$inferSelect;

@Injectable()
export class VaultRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listByOwner(owner: string): Promise<VaultPositionRow[]> {
    return this.db
      .select()
      .from(vaultPositions)
      .where(eq(vaultPositions.owner, owner));
  }

  async findByOwnerAndLockAddress(
    owner: string,
    lockAddress: string,
  ): Promise<VaultPositionRow | null> {
    const rows = await this.db
      .select()
      .from(vaultPositions)
      .where(
        and(
          eq(vaultPositions.owner, owner),
          eq(vaultPositions.lockAddress, lockAddress),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertLock(input: ConfirmLockRequest): Promise<VaultPosition> {
    const values = {
      lockAddress: input.lockAddress,
      owner: input.wallet,
      mint: input.mint,
      assetId: input.assetId,
      ticker: input.ticker,
      amount: String(input.amount),
      createdAt: new Date(),
      unlockAt: input.unlockAt,
      transactionSignature: input.signature,
      indexedAt: new Date(),
    };

    const existing = await this.findByOwnerAndLockAddress(
      input.wallet,
      input.lockAddress,
    );

    const [row] = existing
      ? await this.db
          .update(vaultPositions)
          .set(values)
          .where(eq(vaultPositions.lockAddress, input.lockAddress))
          .returning()
      : await this.db.insert(vaultPositions).values(values).returning();

    return rowToVaultPosition(row);
  }

  async removeLock(owner: string, lockAddress: string): Promise<void> {
    await this.db
      .delete(vaultPositions)
      .where(
        and(
          eq(vaultPositions.owner, owner),
          eq(vaultPositions.lockAddress, lockAddress),
        ),
      );
  }

  async recordExecution(input: {
    walletAddress: string;
    type: 'lock' | 'unlock';
    assetId?: string;
    ticker?: string;
    tokenMint?: string;
    amount?: number;
    transactionSignature: string;
  }): Promise<void> {
    await this.db.insert(executions).values({
      walletAddress: input.walletAddress,
      type: input.type,
      assetId: input.assetId,
      ticker: input.ticker,
      tokenMint: input.tokenMint,
      amount: input.amount !== undefined ? String(input.amount) : undefined,
      provider: 'oren-vault',
      transactionSignature: input.transactionSignature,
      status: 'confirmed',
    });
  }
}

export function rowToVaultPosition(row: VaultPositionRow): VaultPosition {
  return {
    lockAddress: row.lockAddress,
    owner: row.owner,
    mint: row.mint,
    assetId: row.assetId ?? undefined,
    ticker: row.ticker ?? undefined,
    amount: Number(row.amount),
    createdAt: row.createdAt,
    unlockAt: row.unlockAt,
    transactionSignature: row.transactionSignature,
    indexedAt: row.indexedAt,
  };
}
