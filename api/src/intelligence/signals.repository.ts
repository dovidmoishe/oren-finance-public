import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, gte } from 'drizzle-orm';
import type { StockSignals } from '../../types/signals';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { stockSignals } from '../database/schema';

export type StockSignalRow = typeof stockSignals.$inferSelect;

@Injectable()
export class SignalsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getByAssetId(assetId: string): Promise<StockSignals | null> {
    const rows = await this.db
      .select()
      .from(stockSignals)
      .where(eq(stockSignals.assetId, assetId))
      .limit(1);
    return rows[0] ? rowToSignals(rows[0]) : null;
  }

  async upsert(signals: StockSignals): Promise<StockSignals> {
    const values = {
      assetId: signals.assetId,
      ticker: signals.ticker,
      momentum7d: String(signals.momentum7d),
      momentum30d: String(signals.momentum30d),
      volatility30d: String(signals.volatility30d),
      volumeTrend: String(signals.volumeTrend),
      rsi14: String(signals.rsi14),
      sma20: String(signals.sma20),
      sma50: String(signals.sma50),
      liquidityScore: String(signals.liquidityScore),
      activityScore: String(signals.activityScore),
      opportunityScore: String(signals.opportunityScore),
      calculatedAt: signals.calculatedAt,
    };

    const [row] = await this.db
      .insert(stockSignals)
      .values(values)
      .onConflictDoUpdate({
        target: stockSignals.assetId,
        set: values,
      })
      .returning();
    return rowToSignals(row);
  }

  async listByMinScore(
    minScore: number,
    limit: number,
  ): Promise<StockSignals[]> {
    const rows = await this.db
      .select()
      .from(stockSignals)
      .where(gte(stockSignals.opportunityScore, String(minScore)))
      .orderBy(desc(stockSignals.opportunityScore))
      .limit(limit);
    return rows.map(rowToSignals);
  }
}

export function rowToSignals(row: StockSignalRow): StockSignals {
  return {
    assetId: row.assetId,
    ticker: row.ticker,
    momentum7d: Number(row.momentum7d),
    momentum30d: Number(row.momentum30d),
    volatility30d: Number(row.volatility30d),
    volumeTrend: Number(row.volumeTrend),
    rsi14: Number(row.rsi14),
    sma20: Number(row.sma20),
    sma50: Number(row.sma50),
    liquidityScore: Number(row.liquidityScore),
    activityScore: Number(row.activityScore),
    opportunityScore: Number(row.opportunityScore),
    calculatedAt: row.calculatedAt,
  };
}
