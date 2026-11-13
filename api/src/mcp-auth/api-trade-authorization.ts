import { formatRequestForAuthorizationSignature } from '@privy-io/node';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../database/database.provider';
import {
  mcpApiTradeGrants,
  mcpApiTradeAuthorizations,
  mcpConnections,
  mcpTradeIntents,
} from '../database/schema';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { Connection } from '@solana/web3.js';
import type { TokensService } from '../tokens/tokens.service';
import type { ApprovalRpc } from '../execution/approval-rpc.service';
import { inspectApiTradeTransaction } from './api-trade-transaction';
import { usdMicros } from './trade-budget';
import { delegatedUserAllowed } from './delegated-access';
import {
  DAY_MS,
  HOUR_MS,
  grantDurationMatches,
  grantExpired,
  MAX_GRANT_MS,
  validGrantDuration,
} from './grant-duration';
import { randomUUID } from 'node:crypto';
import {
  ownerPermissionMessage,
  verifyOwnerProof,
  sameGrantTerms,
  type OwnerMessage,
  type OwnerProof,
} from './grant-owner-proof';

export type TradeActor = Pick<
  typeof mcpConnections.$inferSelect,
  'grantId' | 'clientId' | 'userId' | 'walletId' | 'wallet'
>;
export interface TradeGrantSettings {
  allowSell: boolean;
  perTradeUsd: number;
  dailyUsd: number;
  maxSlippageBps: number;
  durationHours: number | null;
}
type PreparedGrant = {
  delegationId: string;
  wallet: string;
  perTradeUsd: string;
  dailyUsd: string;
  maxSlippageBps: number;
  allowSell: boolean;
  expiresAt: string | null;
  signerId: string;
  policyId: string;
};
export interface TradeChallenge {
  executionId: string;
  canonicalRequestBase64?: string;
}
export interface ApiTradeAuthorizer {
  authorize(
    intentId: string,
    key: string,
    actor: TradeActor,
    challenge: TradeChallenge,
  ): Promise<Buffer>;
}

const requestSchema = z
  .object({
    version: z.literal(1),
    method: z.literal('POST'),
    url: z.string(),
    body: z
      .object({
        method: z.literal('signTransaction'),
        chain_type: z.literal('solana'),
        params: z
          .object({
            transaction: z.string().min(1).max(1644),
            encoding: z.literal('base64'),
          })
          .strict(),
      })
      .strict(),
    headers: z
      .object({
        'privy-app-id': z.string(),
        'privy-idempotency-key': z.uuid(),
        'privy-request-expiry': z.string().regex(/^\d{13}$/),
      })
      .strict(),
  })
  .strict();

/** API-owned grant and ledger; the signer-gate DB role has no access to either. */
export class ApiTradeAuthorization implements ApiTradeAuthorizer {
  constructor(
    private readonly deps: {
      db: Database;
      auth: PrivyWalletAuth;
      appId: string;
      connection: Connection;
      tokens: TokensService;
      rpc: ApprovalRpc;
      allowedUsers: ReadonlySet<string>;
      publicAccess?: boolean;
      buysEnabled: boolean;
      sellsEnabled: boolean;
      signerQuorumId: string;
      signerPolicyId?: string;
    },
  ) {}

  private matchesSignerPolicy(policyId: string): boolean {
    return !this.deps.signerPolicyId || policyId === this.deps.signerPolicyId;
  }

  async ownerChallenge(
    userToken: string,
    action: OwnerMessage['action'],
    input: {
      delegationId?: string;
      settings?: TradeGrantSettings;
      signerId?: string;
      policyId?: string;
    },
  ) {
    const owner = await this.deps.auth.requireMcpIdentity(
      `Bearer ${userToken}`,
    );
    const now = Date.now();
    let delegationId = input.delegationId;
    let terms: OwnerMessage['terms'] = null;
    let signerId: string | null = null;
    let policyId: string | null = null;
    if (action === 'prepare') {
      const settings = input.settings;
      if (
        !settings ||
        !validGrantDuration(settings.durationHours) ||
        input.signerId !== this.deps.signerQuorumId ||
        !input.policyId ||
        !this.matchesSignerPolicy(input.policyId) ||
        !delegatedUserAllowed(this.deps, owner.userId) ||
        !this.deps.buysEnabled ||
        (settings.allowSell && !this.deps.sellsEnabled)
      )
        throw new Error('Enrollment unavailable');
      signerId = input.signerId;
      policyId = input.policyId;
      const [pending] = await this.deps.db
        .select()
        .from(mcpApiTradeGrants)
        .where(
          and(
            eq(mcpApiTradeGrants.userId, owner.userId),
            eq(mcpApiTradeGrants.walletId, owner.walletId),
            eq(mcpApiTradeGrants.status, 'pending'),
            or(
              isNull(mcpApiTradeGrants.expiresAt),
              gt(mcpApiTradeGrants.expiresAt, new Date()),
            ),
          ),
        );
      terms = {
        perTradeUsd: settings.perTradeUsd.toFixed(6),
        dailyUsd: settings.dailyUsd.toFixed(6),
        maxSlippageBps: settings.maxSlippageBps,
        allowSell: settings.allowSell,
        expiresAt:
          settings.durationHours === null
            ? null
            : new Date(now + settings.durationHours * HOUR_MS).toISOString(),
      };
      delegationId = randomUUID();
      if (pending && !grantExpired(pending.expiresAt, now)) {
        const pendingExpiry = pending.expiresAt?.toISOString() ?? null;
        if (
          pending.signerId !== signerId ||
          pending.policyId !== policyId ||
          pending.perTradeLimitUsd !== terms.perTradeUsd ||
          pending.dailyLimitUsd !== terms.dailyUsd ||
          pending.maxSlippageBps !== terms.maxSlippageBps ||
          pending.allowSell !== terms.allowSell ||
          !grantDurationMatches(pendingExpiry, settings.durationHours, now)
        )
          throw new Error(
            'Revoke the existing pending terms before changing them',
          );
        delegationId = pending.id;
        terms.expiresAt = pendingExpiry;
      }
    } else if (action === 'activate') {
      if (!delegationId) throw new Error('Missing delegation');
      const [grant] = await this.deps.db
        .select()
        .from(mcpApiTradeGrants)
        .where(
          and(
            eq(mcpApiTradeGrants.id, delegationId),
            eq(mcpApiTradeGrants.userId, owner.userId),
            eq(mcpApiTradeGrants.walletId, owner.walletId),
            eq(mcpApiTradeGrants.wallet, owner.wallet),
          ),
        );
      if (
        !grant ||
        grant.status !== 'pending' ||
        !this.matchesSignerPolicy(grant.policyId) ||
        grantExpired(grant.expiresAt, now)
      )
        throw new Error('Fresh browser enrollment is required');
      signerId = grant.signerId;
      policyId = grant.policyId;
      terms = {
        perTradeUsd: grant.perTradeLimitUsd,
        dailyUsd: grant.dailyLimitUsd,
        maxSlippageBps: grant.maxSlippageBps,
        allowSell: grant.allowSell,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      };
    }
    if (!delegationId || !z.uuid().safeParse(delegationId).success)
      throw new Error('Missing delegation');
    return {
      message: ownerPermissionMessage({
        version: 1,
        appId: this.deps.appId,
        action,
        ...owner,
        delegationId,
        nonce: randomUUID(),
        issuedAt: now,
        validUntil: now + 300_000,
        signerId,
        policyId,
        terms,
      }),
    };
  }

  private async browserProof(
    userToken: string,
    proof: OwnerProof,
    action: OwnerMessage['action'],
  ) {
    const owner = await this.deps.auth.requireMcpIdentity(
      `Bearer ${userToken}`,
    );
    const signed = verifyOwnerProof(proof, this.deps.appId, action);
    if (
      signed.userId !== owner.userId ||
      signed.walletId !== owner.walletId ||
      signed.wallet !== owner.wallet
    )
      throw new Error('Permission proof belongs to another browser wallet');
    return signed;
  }

  async verifyPreparation(
    userToken: string,
    proof: OwnerProof,
    settings: TradeGrantSettings,
  ) {
    const signed = await this.browserProof(userToken, proof, 'prepare');
    if (
      !signed.terms ||
      signed.signerId !== this.deps.signerQuorumId ||
      !signed.policyId ||
      !this.matchesSignerPolicy(signed.policyId) ||
      signed.terms.perTradeUsd !== settings.perTradeUsd.toFixed(6) ||
      signed.terms.dailyUsd !== settings.dailyUsd.toFixed(6) ||
      signed.terms.maxSlippageBps !== settings.maxSlippageBps ||
      signed.terms.allowSell !== settings.allowSell ||
      !grantDurationMatches(
        signed.terms.expiresAt,
        settings.durationHours,
        signed.issuedAt,
      )
    )
      throw new Error('Browser did not approve these settings');
    return signed;
  }

  async recordPending(
    userToken: string,
    proof: OwnerProof,
    settings: TradeGrantSettings,
    prepared: PreparedGrant,
  ) {
    const owner = await this.verifyPreparation(userToken, proof, settings);
    const expiresAt =
      prepared.expiresAt === null ? null : new Date(prepared.expiresAt);
    const now = new Date();
    if (
      prepared.delegationId !== owner.delegationId ||
      prepared.wallet !== owner.wallet ||
      prepared.signerId !== this.deps.signerQuorumId ||
      prepared.signerId !== owner.signerId ||
      prepared.policyId !== owner.policyId ||
      !prepared.policyId ||
      usdMicros(prepared.perTradeUsd) !==
        usdMicros(settings.perTradeUsd.toFixed(6)) ||
      usdMicros(prepared.dailyUsd) !==
        usdMicros(settings.dailyUsd.toFixed(6)) ||
      prepared.allowSell !== settings.allowSell ||
      prepared.maxSlippageBps !== settings.maxSlippageBps ||
      (expiresAt !== null &&
        (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)) ||
      prepared.expiresAt !== owner.terms!.expiresAt
    )
      throw new Error('Gate grant differs from browser-reviewed terms');
    await this.deps.db
      .insert(mcpApiTradeGrants)
      .values({
        id: prepared.delegationId,
        userId: owner.userId,
        walletId: owner.walletId,
        wallet: owner.wallet,
        signerId: prepared.signerId,
        policyId: prepared.policyId,
        perTradeLimitUsd: settings.perTradeUsd.toFixed(6),
        dailyLimitUsd: settings.dailyUsd.toFixed(6),
        maxSlippageBps: settings.maxSlippageBps,
        allowSell: settings.allowSell,
        expiresAt,
        createdAt: now,
      })
      .onConflictDoNothing();
    const [saved] = await this.deps.db
      .select()
      .from(mcpApiTradeGrants)
      .where(eq(mcpApiTradeGrants.id, prepared.delegationId));
    if (
      !saved ||
      saved.status !== 'pending' ||
      saved.userId !== owner.userId ||
      saved.walletId !== owner.walletId ||
      saved.wallet !== owner.wallet ||
      saved.signerId !== prepared.signerId ||
      saved.policyId !== prepared.policyId ||
      usdMicros(saved.perTradeLimitUsd) !== usdMicros(prepared.perTradeUsd) ||
      usdMicros(saved.dailyLimitUsd) !== usdMicros(prepared.dailyUsd) ||
      saved.maxSlippageBps !== settings.maxSlippageBps ||
      saved.allowSell !== settings.allowSell ||
      saved.expiresAt?.getTime() !== expiresAt?.getTime()
    )
      throw new Error('Independent grant already has different terms');
  }

  async activate<T>(
    userToken: string,
    proof: OwnerProof,
    id: string,
    activateGate: () => Promise<T>,
  ) {
    const owner = await this.browserProof(userToken, proof, 'activate');
    return this.deps.db.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(mcpApiTradeGrants)
        .where(
          and(
            eq(mcpApiTradeGrants.id, id),
            eq(mcpApiTradeGrants.userId, owner.userId),
            eq(mcpApiTradeGrants.walletId, owner.walletId),
            eq(mcpApiTradeGrants.wallet, owner.wallet),
          ),
        )
        .for('update');
      if (
        !grant ||
        grant.status !== 'pending' ||
        !this.matchesSignerPolicy(grant.policyId) ||
        grantExpired(grant.expiresAt) ||
        !sameGrantTerms(owner, grant)
      )
        throw new Error('Fresh browser enrollment is required');
      const result = await activateGate();
      await tx
        .update(mcpApiTradeGrants)
        .set({ status: 'active', activatedAt: new Date() })
        .where(eq(mcpApiTradeGrants.id, id));
      return result;
    });
  }

  async revoke(userToken: string, proof: OwnerProof, id: string) {
    const owner = await this.browserProof(userToken, proof, 'revoke');
    if (owner.delegationId !== id)
      throw new Error('Revocation targets a different grant');
    // Commit API revocation before contacting a possibly unavailable/malicious gate.
    await this.deps.db
      .update(mcpApiTradeGrants)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(mcpApiTradeGrants.id, id),
          eq(mcpApiTradeGrants.userId, owner.userId),
          eq(mcpApiTradeGrants.walletId, owner.walletId),
          eq(mcpApiTradeGrants.wallet, owner.wallet),
        ),
      );
  }

  async authorize(
    intentId: string,
    key: string,
    actor: TradeActor,
    challenge: TradeChallenge,
  ) {
    if (!delegatedUserAllowed(this.deps, actor.userId))
      throw new Error(
        'Independent trade authorization is disabled for this user',
      );
    if (
      !z.uuid().safeParse(intentId).success ||
      !z.uuid().safeParse(challenge.executionId).success ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(key)
    )
      throw new Error('Invalid signing identity');
    const encoded = challenge.canonicalRequestBase64;
    if (
      !encoded ||
      encoded.length > 8192 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    )
      throw new Error('Invalid canonical signing request');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded)
      throw new Error('Invalid request encoding');
    const request = requestSchema.parse(JSON.parse(bytes.toString('utf8')));
    const expiry = Number(request.headers['privy-request-expiry']);
    if (expiry <= Date.now() || expiry > Date.now() + 31_000)
      throw new Error('Signing request expiry is outside the allowed window');
    const expected = this.deps.auth.signingRequest(
      actor.walletId,
      request.body.params.transaction,
      challenge.executionId,
      new Date(expiry),
    );
    if (
      expected.headers['privy-app-id'] !== this.deps.appId ||
      !bytes.equals(
        Buffer.from(formatRequestForAuthorizationSignature(expected)),
      )
    )
      throw new Error(
        'Canonical request differs from independent authorization',
      );
    const [intent] = await this.deps.db
      .select()
      .from(mcpTradeIntents)
      .where(
        and(
          eq(mcpTradeIntents.id, intentId),
          eq(mcpTradeIntents.grantId, actor.grantId),
          eq(mcpTradeIntents.clientId, actor.clientId),
          eq(mcpTradeIntents.userId, actor.userId),
          eq(mcpTradeIntents.wallet, actor.wallet),
        ),
      );
    if (
      !intent ||
      intent.mode !== 'delegated' ||
      !intent.delegationId ||
      intent.status !== 'executing' ||
      (intent.side === 'buy' && !this.deps.buysEnabled) ||
      (intent.side === 'sell' && !this.deps.sellsEnabled) ||
      intent.expiresAt <= new Date(expiry)
    )
      throw new Error('Owned delegated intent unavailable');
    await this.deps.auth.verifyMcpWallet(
      actor.userId,
      actor.walletId,
      actor.wallet,
    );
    const amountUsd = await inspectApiTradeTransaction(
      request.body.params.transaction,
      intent,
      this.deps,
    );
    await this.deps.db.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(mcpApiTradeGrants)
        .where(eq(mcpApiTradeGrants.id, intent.delegationId!))
        .for('update');
      const [connection] = await tx
        .select()
        .from(mcpConnections)
        .where(eq(mcpConnections.grantId, actor.grantId));
      if (
        !grant ||
        grant.status !== 'active' ||
        grant.userId !== actor.userId ||
        grant.walletId !== actor.walletId ||
        grant.wallet !== actor.wallet ||
        !this.matchesSignerPolicy(grant.policyId) ||
        !grant.activatedAt ||
        grantExpired(grant.expiresAt, expiry) ||
        (grant.expiresAt !== null &&
          grant.expiresAt.getTime() - grant.createdAt.getTime() >
            MAX_GRANT_MS) ||
        (intent.side === 'sell' && !grant.allowSell) ||
        intent.slippageBps > grant.maxSlippageBps ||
        !connection ||
        connection.revokedAt ||
        connection.clientId !== actor.clientId ||
        connection.userId !== actor.userId ||
        connection.walletId !== actor.walletId ||
        connection.wallet !== actor.wallet ||
        connection.createdAt <= grant.activatedAt ||
        connection.createdAt.getTime() + 7 * DAY_MS <= Date.now() ||
        !connection.scopes.split(/\s+/).includes('oren.trade.execute') ||
        expiry <= Date.now() ||
        intent.expiresAt <= new Date()
      )
        throw new Error('Independent trade authorization is inactive');
      const [existing] = await tx
        .select()
        .from(mcpApiTradeAuthorizations)
        .where(eq(mcpApiTradeAuthorizations.intentId, intentId));
      if (existing) {
        if (
          existing.delegationId !== grant.id ||
          existing.executionId !== challenge.executionId ||
          existing.idempotencyKey !== key ||
          existing.canonicalRequestBase64 !== encoded
        )
          throw new Error('Intent already authorizes different bytes');
        return;
      }
      const [usage] = await tx
        .select({
          total: sql<string>`COALESCE(SUM(${mcpApiTradeAuthorizations.amountUsd}), 0)`,
        })
        .from(mcpApiTradeAuthorizations)
        .where(
          and(
            eq(mcpApiTradeAuthorizations.delegationId, grant.id),
            gt(
              mcpApiTradeAuthorizations.createdAt,
              new Date(Date.now() - DAY_MS),
            ),
          ),
        );
      if (
        usdMicros(amountUsd) > usdMicros(grant.perTradeLimitUsd) ||
        usdMicros(usage.total) + usdMicros(amountUsd) >
          usdMicros(grant.dailyLimitUsd)
      )
        throw new Error('Independent trade budget exceeded');
      await tx.insert(mcpApiTradeAuthorizations).values({
        intentId,
        delegationId: grant.id,
        executionId: challenge.executionId,
        idempotencyKey: key,
        canonicalRequestBase64: encoded,
        amountUsd,
      });
    });
    return bytes;
  }
}
