import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type {
  AgentMessage,
  AgentMessageRole,
  AgentThread,
} from '../../types/agent';
import { DRIZZLE } from '../config/constants';
import type { Database } from '../database/database.provider';
import { agentMessages, agentThreads } from '../database/schema';

export type AgentThreadRow = typeof agentThreads.$inferSelect;
export type AgentMessageRow = typeof agentMessages.$inferSelect;

@Injectable()
export class AgentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createThread(walletAddress: string): Promise<AgentThread> {
    const [row] = await this.db
      .insert(agentThreads)
      .values({ walletAddress })
      .returning();
    return rowToThread(row);
  }

  async getThread(id: string): Promise<AgentThread | null> {
    const rows = await this.db
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.id, id))
      .limit(1);
    return rows[0] ? rowToThread(rows[0]) : null;
  }

  async touchThread(id: string): Promise<void> {
    await this.db
      .update(agentThreads)
      .set({ updatedAt: new Date() })
      .where(eq(agentThreads.id, id));
  }

  async insertMessage(input: {
    threadId: string;
    role: AgentMessageRole;
    content: string;
    toolName?: string;
    toolPayload?: unknown;
  }): Promise<AgentMessage> {
    const [row] = await this.db
      .insert(agentMessages)
      .values({
        threadId: input.threadId,
        role: input.role,
        content: input.content,
        toolName: input.toolName,
        toolPayload: input.toolPayload,
      })
      .returning();
    await this.touchThread(input.threadId);
    return rowToMessage(row);
  }

  async listMessages(threadId: string, limit = 20): Promise<AgentMessage[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.threadId, threadId))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(limit);
    return rows.reverse().map(rowToMessage);
  }
}

export function rowToThread(row: AgentThreadRow): AgentThread {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function rowToMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as AgentMessageRole,
    content: row.content,
    toolName: row.toolName ?? undefined,
    toolPayload: row.toolPayload ?? undefined,
    createdAt: row.createdAt,
  };
}
