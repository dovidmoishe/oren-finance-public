import postgres from 'postgres';
import { deploymentCapabilities } from '../../config/deployment';
import type { AppEnv } from '../../config/env.schema';
import { secUserAgent } from './sec-client';

/** Session lock so only one production process on this database calls EDGAR. */
export const SEC_WORKER_LOCK_KEY = 87261001;

const CONTACT = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type SecAccess =
  | { enabled: true; userAgent: string }
  | {
      enabled: false;
      reason:
        | 'sec_not_configured'
        | 'sec_preview_disabled'
        | 'sec_worker_unavailable';
    };

export function secContact(value: string | undefined): string | undefined {
  const email = value?.trim() ?? '';
  if (!email || email.length > 254 || !CONTACT.test(email)) return undefined;
  return email;
}

/**
 * Live EDGAR fetches run only from one production process with an operator
 * supplied contact. Previews share the production IP and do not fetch.
 * An invalid or missing contact disables fetches rather than inventing one.
 */
export function secEdgarAccess(
  env: Pick<AppEnv, 'DEPLOYMENT_ENV' | 'SEC_CONTACT_EMAIL'> & {
    NODE_ENV?: string;
    NODE_APP_INSTANCE?: string;
    WEB_CONCURRENCY?: string;
  },
): SecAccess {
  const deployment = deploymentCapabilities(env);
  if (deployment.environment === 'preview') {
    return { enabled: false, reason: 'sec_preview_disabled' };
  }
  if (deployment.environment !== 'production') {
    return { enabled: false, reason: 'sec_not_configured' };
  }
  const email = secContact(env.SEC_CONTACT_EMAIL);
  if (!email) return { enabled: false, reason: 'sec_not_configured' };
  if (env.NODE_APP_INSTANCE && env.NODE_APP_INSTANCE !== '0') {
    return { enabled: false, reason: 'sec_worker_unavailable' };
  }
  const workers = Number(env.WEB_CONCURRENCY ?? '1');
  if (!Number.isInteger(workers) || workers !== 1) {
    return { enabled: false, reason: 'sec_worker_unavailable' };
  }
  return { enabled: true, userAgent: secUserAgent(email) };
}

export interface SecLockConnection {
  /** Backend pid of the session that was granted the lock. */
  readonly pid: number;
  queryPid(): Promise<number>;
  /** Fires when the database session socket closes. Must not reconnect. */
  onLost(listener: () => void): void;
  /** Release the lock and close. Used only while the original session is alive. */
  unlockAndClose(): Promise<void>;
  /** Close without querying, so a dead pool cannot reconnect to take the lock. */
  shutdown(): Promise<void>;
}

/**
 * Owns one database session for the life of the process. A dropped or
 * replaced session permanently disables this object. It does not reconnect
 * or take the lock again.
 */
export class SecWorkerSession {
  private state: 'holding' | 'lost' | 'closed' = 'holding';
  private readonly listeners = new Set<() => void>();

  private constructor(private readonly connection: SecLockConnection) {
    connection.onLost(() => this.lose());
  }

  static async acquire(
    open: () => Promise<SecLockConnection | undefined>,
  ): Promise<SecWorkerSession | undefined> {
    const connection = await open();
    if (!connection) return undefined;
    return new SecWorkerSession(connection);
  }

  isHeld(): boolean {
    return this.state === 'holding';
  }

  onLost(listener: () => void): void {
    this.listeners.add(listener);
    if (this.state !== 'holding') listener();
  }

  /**
   * Admission for a new EDGAR call. A different backend pid means the pool
   * reconnected without the lock; that is a loss, not a new acquisition.
   */
  async admit(): Promise<boolean> {
    if (!this.isHeld()) return false;
    try {
      const pid = await this.connection.queryPid();
      if (!this.isHeld()) return false;
      if (pid !== this.connection.pid) {
        this.lose();
        return false;
      }
      return true;
    } catch {
      this.lose();
      return false;
    }
  }

  lose(): void {
    if (this.state !== 'holding') return;
    this.state = 'lost';
    this.notify();
    void this.connection.shutdown().catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;
    const holding = this.state === 'holding';
    this.state = 'closed';
    this.notify();
    try {
      if (holding) await this.connection.unlockAndClose();
      else await this.connection.shutdown();
    } catch {
      // The session is already gone. Do not open another one.
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export async function openPostgresLock(
  url: string,
): Promise<SecLockConnection | undefined> {
  let notify: () => void = () => undefined;
  let ending = false;
  let dropped = false;
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 0,
    max_lifetime: 0,
    onclose: () => {
      if (ending) return;
      ending = true;
      dropped = true;
      notify();
      void sql.end({ timeout: 1 }).catch(() => undefined);
    },
  });
  const shutdown = async () => {
    if (ending) return;
    ending = true;
    await sql.end({ timeout: 5 });
  };
  try {
    const rows = await sql<{ locked: boolean; pid: number }[]>`
      SELECT pg_try_advisory_lock(${SEC_WORKER_LOCK_KEY}::bigint) AS locked,
             pg_backend_pid() AS pid
    `;
    const row = rows[0];
    if (!row?.locked || !Number.isInteger(row.pid)) {
      await shutdown();
      return undefined;
    }
    return {
      pid: row.pid,
      queryPid: async () => {
        const again = await sql<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        const pid = again[0]?.pid;
        if (!Number.isInteger(pid)) throw new Error('missing backend pid');
        return pid;
      },
      onLost: (listener) => {
        notify = listener;
        if (dropped) listener();
      },
      unlockAndClose: async () => {
        if (ending) return;
        ending = true;
        try {
          await sql`SELECT pg_advisory_unlock(${SEC_WORKER_LOCK_KEY}::bigint)`;
        } finally {
          await sql.end({ timeout: 5 });
        }
      },
      shutdown,
    };
  } catch (error) {
    await shutdown().catch(() => undefined);
    throw error;
  }
}
