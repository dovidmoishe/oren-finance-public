import { createHmac } from 'node:crypto';
import type {
  Adapter,
  AdapterConstructor,
  AdapterPayload,
} from 'oidc-provider';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { mcpOauthObjects } from '../database/schema';
import type { Database } from '../database/database.provider';

/**
 * oidc-provider needs durable state: its default memory adapter is unsafe across
 * API restarts. The HMAC also keeps bearer-token IDs and short user codes out of
 * database indexes. The key must be stable and secret for the lifetime of grants.
 */
export function createMcpOAuthAdapter(
  db: Database,
  storageKey: Buffer,
): AdapterConstructor {
  if (storageKey.length < 32)
    throw new Error('MCP OAuth storage key is too short');

  return class McpOAuthAdapter implements Adapter {
    constructor(private readonly model: string) {}

    private hash(value: string): string {
      return createHmac('sha256', storageKey)
        .update(this.model)
        .update('\0')
        .update(value)
        .digest('hex');
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn?: number) {
      const value = payload as Record<string, unknown>;
      const row = {
        key: this.hash(id),
        model: this.model,
        payload: value,
        uidHash: typeof value.uid === 'string' ? this.hash(value.uid) : null,
        userCodeHash:
          typeof value.userCode === 'string' ? this.hash(value.userCode) : null,
        grantId: typeof value.grantId === 'string' ? value.grantId : null,
        expiresAt:
          typeof expiresIn === 'number'
            ? new Date(Date.now() + expiresIn * 1000)
            : null,
      };
      if (this.model === 'ReplayDetection') {
        const inserted = await db
          .insert(mcpOauthObjects)
          .values(row)
          .onConflictDoNothing()
          .returning({ key: mcpOauthObjects.key });
        if (!inserted.length) throw new Error('OAuth replay detected');
      } else {
        await db
          .insert(mcpOauthObjects)
          .values(row)
          .onConflictDoUpdate({
            target: mcpOauthObjects.key,
            set: {
              payload: row.payload,
              uidHash: row.uidHash,
              userCodeHash: row.userCodeHash,
              grantId: row.grantId,
              expiresAt: row.expiresAt,
            },
          });
      }
    }

    private async lookup(where: ReturnType<typeof eq>) {
      const [row] = await db
        .select({ payload: mcpOauthObjects.payload })
        .from(mcpOauthObjects)
        .where(
          and(
            eq(mcpOauthObjects.model, this.model),
            where,
            or(
              isNull(mcpOauthObjects.expiresAt),
              gt(mcpOauthObjects.expiresAt, new Date()),
            ),
          ),
        )
        .limit(1);
      return row?.payload as AdapterPayload | undefined;
    }

    find(id: string) {
      return this.lookup(eq(mcpOauthObjects.key, this.hash(id)));
    }

    findByUid(uid: string) {
      return this.lookup(eq(mcpOauthObjects.uidHash, this.hash(uid)));
    }

    findByUserCode(userCode: string) {
      return this.lookup(eq(mcpOauthObjects.userCodeHash, this.hash(userCode)));
    }

    async consume(id: string) {
      // One SQL update ensures two concurrent code exchanges cannot both win.
      const consumed = await db
        .update(mcpOauthObjects)
        .set({
          payload: sql`jsonb_set(${mcpOauthObjects.payload}, '{consumed}', to_jsonb(${Math.floor(Date.now() / 1000)}::integer), true)`,
        })
        .where(
          and(
            eq(mcpOauthObjects.key, this.hash(id)),
            eq(mcpOauthObjects.model, this.model),
            sql`NOT (${mcpOauthObjects.payload} ? 'consumed')`,
          ),
        )
        .returning({ key: mcpOauthObjects.key });
      if (!consumed.length) throw new Error('OAuth token already consumed');
    }

    async destroy(id: string) {
      await db
        .delete(mcpOauthObjects)
        .where(
          and(
            eq(mcpOauthObjects.key, this.hash(id)),
            eq(mcpOauthObjects.model, this.model),
          ),
        );
    }

    async revokeByGrantId(grantId: string) {
      await db
        .delete(mcpOauthObjects)
        .where(
          and(
            eq(mcpOauthObjects.model, this.model),
            eq(mcpOauthObjects.grantId, grantId),
          ),
        );
    }
  };
}
