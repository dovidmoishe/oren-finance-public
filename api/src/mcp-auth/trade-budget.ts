import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../database/database.provider';
import {
  mcpBudgetReservations,
  mcpConnections,
  mcpDelegatedExecutions,
  mcpTradeDelegations,
  mcpTradeIntents,
} from '../database/schema';

import { DAY_MS, grantExpired } from './grant-duration';

/** Numeric(18,6) amounts are compared as exact integer microdollars. */
export function usdMicros(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))
    throw new Error('Invalid USD amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

export function microsUsd(value: bigint): string {
  if (value < 0n) throw new Error('Invalid USD amount');
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, '0')}`;
}

/** USDC raw units are microdollars. Never price a buy from API display data. */
export function buyNotionalUsd(rawInput: string, amountUsd: string | null) {
  if (!/^[1-9]\d{0,19}$/.test(rawInput) || !amountUsd) return undefined;
  try {
    const raw = BigInt(rawInput);
    return raw <= 18_446_744_073_709_551_615n && usdMicros(amountUsd) === raw
      ? microsUsd(raw)
      : undefined;
  } catch {
    return undefined;
  }
}

export function sellNotionalUsd(
  referenceValueUsd: string,
  quotedProceedsUsd: string,
): string {
  const reference = usdMicros(referenceValueUsd);
  const proceeds = usdMicros(quotedProceedsUsd);
  const amount = reference > proceeds ? reference : proceeds;
  if (amount <= 0n) throw new Error('Sell notional must be positive');
  return `${amount / 1_000_000n}.${String(amount % 1_000_000n).padStart(6, '0')}`;
}

/** Compute charge from saved terms and the fresh route, including share cap. */
export function reservationNotionalUsd(
  intent: {
    side: 'buy' | 'sell';
    maxInRaw: string | null;
    amountUsd: string | null;
    referenceValueUsd: string | null;
    quotedProceedsUsd: string | null;
  },
  fresh: {
    rawInput: string;
    referenceValueUsd?: string;
    quotedProceedsUsd?: string;
  },
): string | undefined {
  if (
    !intent.maxInRaw ||
    !/^\d+$/.test(intent.maxInRaw) ||
    !/^\d+$/.test(fresh.rawInput) ||
    BigInt(fresh.rawInput) <= 0n ||
    BigInt(fresh.rawInput) > BigInt(intent.maxInRaw)
  )
    return undefined;
  if (intent.side === 'buy')
    return fresh.rawInput === intent.maxInRaw
      ? buyNotionalUsd(fresh.rawInput, intent.amountUsd)
      : undefined;
  if (
    !intent.referenceValueUsd ||
    !intent.quotedProceedsUsd ||
    !fresh.referenceValueUsd ||
    !fresh.quotedProceedsUsd
  )
    return undefined;
  const prepared = sellNotionalUsd(
    intent.referenceValueUsd,
    intent.quotedProceedsUsd,
  );
  const current = sellNotionalUsd(
    fresh.referenceValueUsd,
    fresh.quotedProceedsUsd,
  );
  return usdMicros(prepared) > usdMicros(current) ? prepared : current;
}

export type ReserveResult =
  | { status: 'reserved'; reservationId: string; amountUsd: string }
  | { status: 'existing'; reservationId: string; amountUsd: string }
  | { status: 'over_budget' | 'inactive' | 'invalid_intent' | 'conflict' };

/** Claims one immutable intent and its rolling budget under a delegation row lock. */
export async function reserveTradeBudget(
  db: Database,
  input: {
    delegationId: string;
    intentId: string;
    grantId: string;
    clientId: string;
    userId: string;
    walletId: string;
    wallet: string;
    idempotencyKey: string;
    /** Exact fresh route input; sells may never exceed the prepared share input. */
    rawInput: string;
    /** Independent stock reference valuation at execution time. */
    referenceValueUsd?: string;
    /** Fresh USDC output quote at execution time. */
    quotedProceedsUsd?: string;
    /** Stored in the same transaction as the reservation and intent claim. */
    execution?: typeof mcpDelegatedExecutions.$inferInsert;
  },
): Promise<ReserveResult> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey))
    return { status: 'invalid_intent' };
  return db.transaction(async (tx) => {
    const [delegation] = await tx
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.id, input.delegationId),
          eq(mcpTradeDelegations.userId, input.userId),
          eq(mcpTradeDelegations.walletId, input.walletId),
          eq(mcpTradeDelegations.wallet, input.wallet),
        ),
      )
      .for('update');
    if (
      !delegation ||
      delegation.status !== 'active' ||
      grantExpired(delegation.expiresAt)
    )
      return { status: 'inactive' } as const;
    const [connection] = await tx
      .select({
        grantId: mcpConnections.grantId,
        createdAt: mcpConnections.createdAt,
        scopes: mcpConnections.scopes,
      })
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.grantId, input.grantId),
          eq(mcpConnections.clientId, input.clientId),
          eq(mcpConnections.userId, input.userId),
          eq(mcpConnections.walletId, input.walletId),
          eq(mcpConnections.wallet, input.wallet),
          isNull(mcpConnections.revokedAt),
        ),
      );
    if (
      !connection ||
      !connection.scopes.split(/\s+/).includes('oren.trade.execute') ||
      !delegation.activatedAt ||
      connection.createdAt <= delegation.activatedAt
    )
      return { status: 'inactive' } as const;
    const [intent] = await tx
      .select()
      .from(mcpTradeIntents)
      .where(
        and(
          eq(mcpTradeIntents.id, input.intentId),
          eq(mcpTradeIntents.delegationId, delegation.id),
          eq(mcpTradeIntents.grantId, input.grantId),
          eq(mcpTradeIntents.clientId, input.clientId),
          eq(mcpTradeIntents.userId, input.userId),
          eq(mcpTradeIntents.wallet, input.wallet),
        ),
      )
      .for('update');
    if (!intent || intent.mode !== 'delegated')
      return { status: 'invalid_intent' } as const;
    if (intent.status !== 'prepared') {
      if (intent.idempotencyKey !== input.idempotencyKey)
        return { status: 'conflict' } as const;
      const [reservation] = await tx
        .select()
        .from(mcpBudgetReservations)
        .where(eq(mcpBudgetReservations.intentId, intent.id));
      return reservation
        ? ({
            status: 'existing',
            reservationId: reservation.id,
            amountUsd: reservation.amountUsd,
          } as const)
        : ({ status: 'conflict' } as const);
    }
    if (
      intent.expiresAt <= new Date() ||
      (intent.side === 'sell' && !delegation.allowSell) ||
      intent.slippageBps > delegation.maxSlippageBps
    )
      return { status: 'invalid_intent' } as const;
    const amountUsd = reservationNotionalUsd(intent, input);
    if (!amountUsd) return { status: 'invalid_intent' } as const;
    const amount = usdMicros(amountUsd);
    if (amount <= 0n) return { status: 'invalid_intent' } as const;
    if (amount > usdMicros(delegation.perTradeLimitUsd))
      return { status: 'over_budget' } as const;
    const [usage] = await tx
      .select({
        total: sql<string>`COALESCE(SUM(${mcpBudgetReservations.amountUsd}), 0)`,
      })
      .from(mcpBudgetReservations)
      .where(
        and(
          eq(mcpBudgetReservations.delegationId, delegation.id),
          or(
            eq(mcpBudgetReservations.status, 'reserved'),
            and(
              eq(mcpBudgetReservations.status, 'consumed'),
              gt(
                mcpBudgetReservations.createdAt,
                new Date(Date.now() - DAY_MS),
              ),
            ),
          ),
        ),
      );
    if (usdMicros(usage.total) + amount > usdMicros(delegation.dailyLimitUsd))
      return { status: 'over_budget' } as const;
    await tx
      .update(mcpTradeIntents)
      .set({ status: 'executing', idempotencyKey: input.idempotencyKey })
      .where(eq(mcpTradeIntents.id, intent.id));
    const [reservation] = await tx
      .insert(mcpBudgetReservations)
      .values({
        delegationId: delegation.id,
        intentId: intent.id,
        amountUsd,
      })
      .returning({
        id: mcpBudgetReservations.id,
        amountUsd: mcpBudgetReservations.amountUsd,
      });
    if (input.execution) {
      if (
        input.execution.intentId !== intent.id ||
        input.execution.idempotencyKey !== input.idempotencyKey
      )
        throw new Error('Execution does not match the claimed intent');
      await tx.insert(mcpDelegatedExecutions).values(input.execution);
    }
    return {
      status: 'reserved',
      reservationId: reservation.id,
      amountUsd: reservation.amountUsd,
    } as const;
  });
}

/** Only a confirmed trade consumes budget; only a definite failure releases it. */
export async function settleTradeBudget(
  db: Database,
  intentId: string,
  outcome: 'confirmed' | 'definite_failure',
) {
  return db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(mcpBudgetReservations)
      .where(eq(mcpBudgetReservations.intentId, intentId))
      .for('update');
    if (!reservation || reservation.status !== 'reserved') return reservation;
    const status = outcome === 'confirmed' ? 'consumed' : 'released';
    const [updated] = await tx
      .update(mcpBudgetReservations)
      .set({ status, settledAt: new Date() })
      .where(eq(mcpBudgetReservations.id, reservation.id))
      .returning();
    await tx
      .update(mcpTradeIntents)
      .set({ status: outcome === 'confirmed' ? 'confirmed' : 'failed' })
      .where(eq(mcpTradeIntents.id, intentId));
    return updated;
  });
}
