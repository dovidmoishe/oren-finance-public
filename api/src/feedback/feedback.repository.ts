import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import type {
  FeedbackKind,
  FeedbackStatus,
  FeedbackTicket,
  FeedbackTicketInput,
} from '../../types/feedback';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { feedbackTickets } from '../database/schema';

@Injectable()
export class FeedbackRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(
    owner: { userId: string; walletAddress: string; email?: string },
    input: FeedbackTicketInput,
  ): Promise<FeedbackTicket> {
    const [row] = await this.db
      .insert(feedbackTickets)
      .values({ ...owner, ...input })
      .returning();
    return fromRow(row);
  }

  async list(userId: string): Promise<FeedbackTicket[]> {
    const rows = await this.db
      .select()
      .from(feedbackTickets)
      .where(eq(feedbackTickets.userId, userId))
      .orderBy(desc(feedbackTickets.createdAt))
      .limit(20);
    return rows.map(fromRow);
  }

  async countSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(feedbackTickets)
      .where(
        and(
          eq(feedbackTickets.userId, userId),
          gte(feedbackTickets.createdAt, since),
        ),
      );
    return row?.total ?? 0;
  }
}

function fromRow(row: typeof feedbackTickets.$inferSelect): FeedbackTicket {
  return {
    id: row.id,
    kind: row.kind as FeedbackKind,
    subject: row.subject,
    message: row.message,
    page: row.page ?? undefined,
    status: row.status as FeedbackStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
