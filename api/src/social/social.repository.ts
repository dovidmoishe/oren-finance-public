import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { traderProfiles } from '../database/schema';

export type TraderProfileRow = typeof traderProfiles.$inferSelect;

export interface UpsertTraderProfileInput {
  walletAddress: string;
  slug: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic: boolean;
}

@Injectable()
export class SocialRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listPublicProfiles(): Promise<TraderProfileRow[]> {
    return this.db
      .select()
      .from(traderProfiles)
      .where(eq(traderProfiles.isPublic, true));
  }

  async findBySlug(slug: string): Promise<TraderProfileRow | null> {
    const [row] = await this.db
      .select()
      .from(traderProfiles)
      .where(eq(traderProfiles.slug, slug))
      .limit(1);
    return row ?? null;
  }

  async findByWallet(walletAddress: string): Promise<TraderProfileRow | null> {
    const [row] = await this.db
      .select()
      .from(traderProfiles)
      .where(eq(traderProfiles.walletAddress, walletAddress))
      .limit(1);
    return row ?? null;
  }

  async upsertProfile(
    input: UpsertTraderProfileInput,
  ): Promise<TraderProfileRow> {
    const [row] = await this.db
      .insert(traderProfiles)
      .values({
        walletAddress: input.walletAddress,
        slug: input.slug,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        bio: input.bio,
        isPublic: input.isPublic,
      })
      .onConflictDoUpdate({
        target: traderProfiles.walletAddress,
        set: {
          slug: input.slug,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          bio: input.bio,
          isPublic: input.isPublic,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
}
