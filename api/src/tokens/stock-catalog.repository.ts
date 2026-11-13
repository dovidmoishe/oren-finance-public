import { Inject, Injectable } from '@nestjs/common';
import { asc, count, desc, ilike, inArray, or } from 'drizzle-orm';
import type { Equity, EquityCategory, EquitySummary } from '../../types/equity';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { cachedStocks } from '../database/schema';

export type CachedStockRow = typeof cachedStocks.$inferSelect;

@Injectable()
export class StockCatalogRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listPage(
    offset: number,
    limit: number,
    now = new Date(),
  ): Promise<{ items: EquitySummary[]; total: number; isFresh: boolean }> {
    const [rows, totalRows, latestRows] = await Promise.all([
      this.db
        .select()
        .from(cachedStocks)
        .orderBy(asc(cachedStocks.sortRank))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(cachedStocks),
      this.db
        .select({ expiresAt: cachedStocks.expiresAt })
        .from(cachedStocks)
        .orderBy(desc(cachedStocks.cachedAt))
        .limit(1),
    ]);

    const total = Number(totalRows[0]?.total ?? 0);
    return {
      items: rows.map(rowToStockSummary),
      total,
      isFresh:
        total > 0 &&
        Boolean(latestRows[0]?.expiresAt.getTime() > now.getTime()),
    };
  }

  async findByAssetIds(assetIds: string[]): Promise<EquitySummary[]> {
    if (assetIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(cachedStocks)
      .where(inArray(cachedStocks.assetId, assetIds));
    return rows.map(rowToStockSummary);
  }

  async search(query: string, limit = 20): Promise<EquitySummary[]> {
    const pattern = `%${query.trim()}%`;
    const rows = await this.db
      .select()
      .from(cachedStocks)
      .where(
        or(
          ilike(cachedStocks.ticker, pattern),
          ilike(cachedStocks.name, pattern),
        ),
      )
      .orderBy(asc(cachedStocks.sortRank))
      .limit(limit);
    return rows.map(rowToStockSummary);
  }

  async replaceAll(stocks: Equity[], expiresAt: Date): Promise<void> {
    if (stocks.length === 0) return;
    const cachedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx.delete(cachedStocks);
      await tx.insert(cachedStocks).values(
        stocks.map((stock, sortRank) => ({
          assetId: stock.id,
          ticker: stock.ticker,
          name: stock.name,
          category: stock.category,
          logo: stock.logo,
          price: toNumeric(stock.price),
          priceChange24h: toNumeric(stock.priceChange24h),
          volume24h: toNumeric(stock.volume24h),
          liquidity: toNumeric(stock.liquidity),
          sortRank,
          cachedAt,
          expiresAt,
        })),
      );
    });
  }
}

export function rowToStockSummary(row: CachedStockRow): EquitySummary {
  return {
    id: row.assetId,
    ticker: row.ticker,
    name: row.name,
    category: asEquityCategory(row.category),
    logo: row.logo ?? undefined,
    price: toNumber(row.price),
    priceChange24h: toNumber(row.priceChange24h),
    volume24h: toNumber(row.volume24h),
    liquidity: toNumber(row.liquidity),
  };
}

function asEquityCategory(value: string): EquityCategory {
  return value === 'etf' || value === 'index' ? value : 'equity';
}

function toNumeric(value: number | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : null;
}

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
