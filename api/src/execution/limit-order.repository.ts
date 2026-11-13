import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { limitOrders } from '../database/schema';
import type {
  LimitOrderRecord,
  LimitOrderStatus,
} from '../../types/limit-order';
import type { TradeSide } from '../../types/quote';
import type { LimitZoneBasis } from '../../types/analysis';

export type LimitOrderRow = typeof limitOrders.$inferSelect;

export interface UpsertLimitOrderInput {
  walletAddress: string;
  orderKey: string;
  side: TradeSide;
  assetId?: string;
  ticker?: string;
  inputMint: string;
  outputMint: string;
  makingAmount: number;
  takingAmount: number;
  limitPriceUsd: number;
  amountUsd?: number;
  status: LimitOrderStatus;
  basis?: LimitZoneBasis;
  openSignature?: string;
  closeSignature?: string;
  expiredAt?: Date;
}

@Injectable()
export class LimitOrderRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async upsert(input: UpsertLimitOrderInput): Promise<LimitOrderRow> {
    const existing = await this.findByOrderKey(input.orderKey);
    if (existing) {
      if (existing.walletAddress !== input.walletAddress) {
        throw new ForbiddenException(
          'This limit order does not belong to your wallet',
        );
      }
      const [row] = await this.db
        .update(limitOrders)
        .set({
          status: input.status,
          openSignature: input.openSignature ?? existing.openSignature,
          closeSignature: input.closeSignature ?? existing.closeSignature,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(limitOrders.orderKey, input.orderKey),
            eq(limitOrders.walletAddress, input.walletAddress),
          ),
        )
        .returning();
      return row;
    }

    const [row] = await this.db
      .insert(limitOrders)
      .values({
        walletAddress: input.walletAddress,
        orderKey: input.orderKey,
        side: input.side,
        assetId: input.assetId,
        ticker: input.ticker,
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        makingAmount: String(input.makingAmount),
        takingAmount: String(input.takingAmount),
        limitPriceUsd: String(input.limitPriceUsd),
        amountUsd:
          input.amountUsd !== undefined ? String(input.amountUsd) : undefined,
        status: input.status,
        basis: input.basis,
        openSignature: input.openSignature,
        closeSignature: input.closeSignature,
        expiredAt: input.expiredAt,
      })
      .returning();
    return row;
  }

  async updateStatus(
    orderKey: string,
    patch: {
      status: LimitOrderStatus;
      closeSignature?: string;
    },
    walletAddress: string,
  ): Promise<LimitOrderRow | null> {
    const [row] = await this.db
      .update(limitOrders)
      .set({
        status: patch.status,
        ...(patch.closeSignature !== undefined
          ? { closeSignature: patch.closeSignature }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(limitOrders.orderKey, orderKey),
          eq(limitOrders.walletAddress, walletAddress),
        ),
      )
      .returning();
    return row ?? null;
  }

  async findByOrderKey(orderKey: string): Promise<LimitOrderRow | null> {
    const rows = await this.db
      .select()
      .from(limitOrders)
      .where(eq(limitOrders.orderKey, orderKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByWallet(walletAddress: string): Promise<LimitOrderRow[]> {
    return this.db
      .select()
      .from(limitOrders)
      .where(eq(limitOrders.walletAddress, walletAddress))
      .orderBy(desc(limitOrders.createdAt));
  }

  async listOpenByWallet(walletAddress: string): Promise<LimitOrderRow[]> {
    return this.db
      .select()
      .from(limitOrders)
      .where(
        and(
          eq(limitOrders.walletAddress, walletAddress),
          eq(limitOrders.status, 'open'),
        ),
      )
      .orderBy(desc(limitOrders.createdAt));
  }

  async listAllOpen(): Promise<LimitOrderRow[]> {
    return this.db
      .select()
      .from(limitOrders)
      .where(eq(limitOrders.status, 'open'))
      .orderBy(desc(limitOrders.updatedAt));
  }

  toRecord(row: LimitOrderRow): LimitOrderRecord {
    return {
      id: row.id,
      walletAddress: row.walletAddress,
      orderKey: row.orderKey,
      side: row.side as TradeSide,
      assetId: row.assetId ?? undefined,
      ticker: row.ticker ?? undefined,
      inputMint: row.inputMint,
      outputMint: row.outputMint,
      makingAmount: Number(row.makingAmount),
      takingAmount: Number(row.takingAmount),
      limitPriceUsd: Number(row.limitPriceUsd),
      amountUsd: row.amountUsd !== null ? Number(row.amountUsd) : undefined,
      status: row.status as LimitOrderStatus,
      basis: (row.basis as LimitZoneBasis | null) ?? undefined,
      openSignature: row.openSignature ?? undefined,
      closeSignature: row.closeSignature ?? undefined,
      expiredAt: row.expiredAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
