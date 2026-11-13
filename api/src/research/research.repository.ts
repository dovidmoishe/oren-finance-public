import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { ResearchSnapshot, SavedThesis } from '../../types/research';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { researchEvents, savedResearch } from '../database/schema';

@Injectable()
export class ResearchRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async get(userId: string, assetId: string): Promise<SavedThesis | undefined> {
    const [row] = await this.db
      .select()
      .from(savedResearch)
      .where(
        and(
          eq(savedResearch.userId, userId),
          eq(savedResearch.assetId, assetId),
        ),
      )
      .limit(1);
    return row && fromRow(row);
  }

  async list(userId: string): Promise<SavedThesis[]> {
    const rows = await this.db
      .select()
      .from(savedResearch)
      .where(eq(savedResearch.userId, userId))
      .orderBy(desc(savedResearch.updatedAt))
      .limit(100);
    return rows.map(fromRow);
  }

  async save(
    userId: string,
    assetId: string,
    note: string,
    snapshot: ResearchSnapshot,
  ): Promise<SavedThesis> {
    const [row] = await this.db
      .insert(savedResearch)
      .values({ userId, assetId, note, snapshot })
      .onConflictDoUpdate({
        target: [savedResearch.userId, savedResearch.assetId],
        set: { note, snapshot, updatedAt: new Date() },
      })
      .returning();
    return fromRow(row);
  }

  async updateNote(
    userId: string,
    assetId: string,
    note: string,
  ): Promise<SavedThesis | undefined> {
    const [row] = await this.db
      .update(savedResearch)
      .set({ note, updatedAt: new Date() })
      .where(
        and(
          eq(savedResearch.userId, userId),
          eq(savedResearch.assetId, assetId),
        ),
      )
      .returning();
    return row && fromRow(row);
  }

  async remove(userId: string, assetId: string): Promise<void> {
    await this.db
      .delete(savedResearch)
      .where(
        and(
          eq(savedResearch.userId, userId),
          eq(savedResearch.assetId, assetId),
        ),
      );
  }

  async recordEvent(
    userId: string,
    assetId: string,
    kind: 'open' | 'revisit' | 'save' | 'source_open',
  ): Promise<void> {
    await this.db.insert(researchEvents).values({ userId, assetId, kind });
  }
}

function fromRow(row: typeof savedResearch.$inferSelect): SavedThesis {
  return {
    id: row.id,
    assetId: row.assetId,
    note: row.note,
    snapshot: row.snapshot,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
