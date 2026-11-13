import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import type { MarketNewsItem } from '../../types/news';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { cachedNews } from '../database/schema';

export type CachedNewsRow = typeof cachedNews.$inferSelect;

@Injectable()
export class NewsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listFresh(
    assetId: string | undefined,
    now: Date,
    limit: number,
  ): Promise<MarketNewsItem[]> {
    const rows = await this.db
      .select()
      .from(cachedNews)
      .where(and(scopeWhere(assetId), gte(cachedNews.expiresAt, now)))
      .orderBy(desc(cachedNews.publishedAt), desc(cachedNews.cachedAt))
      .limit(limit);

    return rows.map(rowToNewsItem);
  }

  async replaceScope(
    assetId: string | undefined,
    items: MarketNewsItem[],
    expiresAt: Date,
  ): Promise<void> {
    await this.db.delete(cachedNews).where(scopeWhere(assetId));

    if (items.length === 0) return;

    await this.db.insert(cachedNews).values(
      items.map((item) => ({
        assetId: assetId ?? null,
        headline: item.headline,
        source: item.source,
        summary: item.summary,
        url: item.url,
        publishedAt: item.publishedAt,
        payload: itemToPayload(item),
        expiresAt,
      })),
    );
  }
}

export function rowToNewsItem(row: CachedNewsRow): MarketNewsItem {
  const payload = asRecord(row.payload);
  return {
    id: asString(payload.id),
    assetId: asString(payload.assetId) ?? row.assetId ?? undefined,
    ticker: asString(payload.ticker),
    headline: row.headline,
    source: row.source ?? asString(payload.source),
    summary: row.summary ?? asString(payload.summary),
    url: row.url ?? asString(payload.url),
    publishedAt:
      row.publishedAt ??
      toDate(payload.publishedAt) ??
      row.cachedAt,
    imageUrl: asString(payload.imageUrl),
  };
}

function scopeWhere(assetId: string | undefined) {
  return assetId ? eq(cachedNews.assetId, assetId) : isNull(cachedNews.assetId);
}

function itemToPayload(item: MarketNewsItem): Record<string, unknown> {
  return {
    ...item,
    publishedAt: item.publishedAt.toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
