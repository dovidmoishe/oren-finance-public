import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  policyAllowsStock,
  policyAllowsDestinationAccount,
  signingPolicyExpiresAt,
} from './policy-stock-coverage';
import {
  signingFailureDetails,
  signingOutcome,
} from '../mcp-auth/signing-outcome';
import {
  formatRequestForAuthorizationSignature,
  generateAuthorizationSignature,
  PrivyClient,
  type WalletApiRequestSignatureInput,
} from '@privy-io/node';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../database/database.provider';
import {
  mcpConnections,
  mcpBudgetReservations,
  mcpDelegatedExecutions,
  mcpTradeDelegations,
  mcpTradeIntents,
  mcpAuditEvents,
} from '../database/schema';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import {
  reservationNotionalUsd,
  reserveTradeBudget,
  settleTradeBudget,
  usdMicros,
} from '../mcp-auth/trade-budget';
import {
  retryOnceOnSlippage,
  slippageExceededMessage,
} from '../execution/simulation-reason';
import type { JupiterClient } from '../execution/jupiter/jupiter.client';
import type { TokensService } from '../tokens/tokens.service';
import type { ApprovalRpc } from '../execution/approval-rpc.service';
import type { Connection } from '@solana/web3.js';
import { buildGateJupiterRoute } from './gate-jupiter';
import { USDC_MINT } from '../config/constants';
import { delegatedUserAllowed } from '../mcp-auth/delegated-access';
import {
  CUSTOM_GRANT_SPEND_LIMITS,
  LEGACY_GRANT_SPEND_LIMITS,
  isGrantUsdAmount,
} from '../mcp-auth/grant-spend-limits';
import {
  HOUR_MS,
  grantDurationMatches,
  grantExpired,
  MAX_GRANT_HOURS,
  MAX_GRANT_MS,
} from '../mcp-auth/grant-duration';
import {
  verifyOwnerProof,
  sameGrantTerms,
  type OwnerProof,
  type OwnerMessage,
} from '../mcp-auth/grant-owner-proof';

type Delegation = typeof mcpTradeDelegations.$inferSelect;
type Execution = typeof mcpDelegatedExecutions.$inferSelect;
type PrivyPolicy = Awaited<
  ReturnType<ReturnType<PrivyClient['policies']>['get']>
>;

function grantSpendLimits(policy: PrivyPolicy, sellsEnabled: boolean) {
  const cap = String(CUSTOM_GRANT_SPEND_LIMITS.maxPerTradeUsd * 1_000_000);
  const sides = sellsEnabled ? ['buy', 'sell'] : ['buy'];
  const supportsCustomLimits = sides.every((side) =>
    policy.rules.some(
      (rule) =>
        rule.name === `allow bounded jupiter ${side}` &&
        rule.action === 'ALLOW' &&
        rule.conditions?.some(
          (condition) =>
            condition.field_source === 'solana_instruction_data' &&
            condition.field ===
              `shared_accounts_route.args.${side === 'buy' ? 'in_amount' : 'quoted_out_amount'}` &&
            condition.operator === 'lte' &&
            condition.value === cap,
        ),
    ),
  );
  return supportsCustomLimits
    ? CUSTOM_GRANT_SPEND_LIMITS
    : LEGACY_GRANT_SPEND_LIMITS;
}

/** Exact rule contents remain pinned by gatePolicyFingerprint. */
export function gatePolicyRulesValid(
  policy: PrivyPolicy,
  sellsEnabled: boolean,
) {
  const rules = policy.rules;
  if (!rules || rules.some((rule) => rule.method !== 'signTransaction'))
    return false;
  const buys = 'allow bounded jupiter buy';
  const sells = 'allow bounded jupiter sell';
  const compute = 'allow compute budget';
  const compactNames = sellsEnabled ? [compute, buys, sells] : [compute, buys];
  if (rules.length === compactNames.length)
    return (
      compactNames.every((name) => rules.some((rule) => rule.name === name)) &&
      rules.every(
        (rule) =>
          rule.action === 'ALLOW' &&
          !rule.conditions?.some(
            (condition) =>
              condition.field_source === 'system' &&
              condition.field === 'current_unix_timestamp',
          ),
      )
    );
  if (!sellsEnabled) return rules.length === 3;
  return (
    rules.length >= 4 &&
    rules.length <= 46 &&
    rules.some((rule) => rule.name === buys) &&
    rules.some((rule) => rule.name === sells)
  );
}

export interface SignerGateConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  apiPublicKeyDerBase64: string;
  gatePrivateKeyDerBase64: string;
  signerQuorumId: string;
  policyId: string;
  policyOwnerId: string;
  policyHash: string;
  allowedUsers: Set<string>;
  publicAccess?: boolean;
  buysEnabled: boolean;
  sellsEnabled: boolean;
}

export interface SignerGateDependencies {
  db: Database;
  jupiter: JupiterClient;
  tokens: TokensService;
  rpc: ApprovalRpc;
  connection: Connection;
  privy: PrivyClient;
  auth: PrivyWalletAuth;
}

/** Hash only the owner-reviewed policy semantics, excluding Privy metadata. */
export function gatePolicyFingerprint(policy: PrivyPolicy) {
  const normalized = {
    owner_id: policy.owner_id,
    chain_type: policy.chain_type,
    version: policy.version,
    rules: policy.rules?.map((rule) => ({
      name: rule.name,
      method: rule.method,
      action: rule.action,
      conditions: rule.conditions?.map((item) => ({
        field_source: item.field_source,
        field: item.field,
        operator: item.operator,
        value: item.value,
        idl: 'idl' in item ? (item.idl ?? null) : null,
      })),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function canonical(execution: Execution) {
  return Buffer.from(
    formatRequestForAuthorizationSignature(
      execution.privyRequest as unknown as WalletApiRequestSignatureInput,
    ),
  );
}

/** The gate never accepts an API-supplied transaction, route, wallet, or digest. */
export class SignerGateService {
  constructor(
    private readonly config: SignerGateConfig,
    private readonly deps: SignerGateDependencies,
  ) {}

  private assertEnabled() {
    if (!this.config.enabled) throw new Error('Delegated signing is disabled');
  }

  private async browserOwner(
    proof: OwnerProof,
    action: OwnerMessage['action'],
    requireAllowlist = true,
  ) {
    const owner = verifyOwnerProof(proof, this.config.appId, action);
    await this.deps.auth.verifyMcpWallet(
      owner.userId,
      owner.walletId,
      owner.wallet,
    );
    if (requireAllowlist && !delegatedUserAllowed(this.config, owner.userId))
      throw new Error('User is not allowlisted for delegated trading');
    return owner;
  }

  private async verifyPolicy() {
    const policy = await this.deps.privy.policies().get(this.config.policyId);
    if (
      policy.owner_id !== this.config.policyOwnerId ||
      policy.chain_type !== 'solana' ||
      !gatePolicyRulesValid(policy, this.config.sellsEnabled) ||
      gatePolicyFingerprint(policy) !== this.config.policyHash
    )
      throw new Error('Privy policy differs from owner-reviewed terms');
    return policy;
  }

  async grantLimits() {
    this.assertEnabled();
    const policy = await this.verifyPolicy();
    const expiresAt = signingPolicyExpiresAt(policy);
    const spendLimits = grantSpendLimits(policy, this.config.sellsEnabled);
    return expiresAt === null
      ? { untilRevoked: true, spendLimits }
      : {
          spendLimits,
          maxDurationHours: Math.max(
            0,
            Math.min(
              MAX_GRANT_HOURS,
              Math.floor((expiresAt - Date.now()) / HOUR_MS),
            ),
          ),
        };
  }

  async prepareGrant(
    proof: OwnerProof,
    settings: {
      allowSell: boolean;
      perTradeUsd: number;
      dailyUsd: number;
      maxSlippageBps: number;
      durationHours: number | null;
    },
  ) {
    this.assertEnabled();
    const owner = await this.browserOwner(proof, 'prepare');
    if (
      !owner.terms ||
      owner.signerId !== this.config.signerQuorumId ||
      owner.policyId !== this.config.policyId ||
      owner.terms.perTradeUsd !== settings.perTradeUsd.toFixed(6) ||
      owner.terms.dailyUsd !== settings.dailyUsd.toFixed(6) ||
      owner.terms.maxSlippageBps !== settings.maxSlippageBps ||
      owner.terms.allowSell !== settings.allowSell ||
      !grantDurationMatches(
        owner.terms.expiresAt,
        settings.durationHours,
        owner.issuedAt,
      )
    )
      throw new Error('Grant differs from wallet-authorized terms');
    if (
      !this.config.buysEnabled ||
      (settings.allowSell && !this.config.sellsEnabled) ||
      !isGrantUsdAmount(settings.perTradeUsd) ||
      !isGrantUsdAmount(settings.dailyUsd) ||
      settings.dailyUsd < settings.perTradeUsd ||
      !Number.isInteger(settings.maxSlippageBps) ||
      settings.maxSlippageBps < 1 ||
      settings.maxSlippageBps > 50
    )
      throw new Error('Grant terms exceed the owner-only limits');
    const expiresAt =
      owner.terms.expiresAt === null ? null : new Date(owner.terms.expiresAt);
    const policy = await this.verifyPolicy();
    const limits = grantSpendLimits(policy, this.config.sellsEnabled);
    if (
      settings.perTradeUsd > limits.maxPerTradeUsd ||
      settings.dailyUsd > limits.maxDailyUsd
    )
      throw new Error('Grant exceeds the signing policy spend limits');
    const policyExpiry = signingPolicyExpiresAt(policy);
    if (
      policyExpiry !== null &&
      (expiresAt === null || expiresAt.getTime() > policyExpiry)
    )
      throw new Error('Grant duration exceeds the signing policy expiry');
    const [open] = await this.deps.db
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.walletId, owner.walletId),
          eq(mcpTradeDelegations.userId, owner.userId),
          eq(mcpTradeDelegations.wallet, owner.wallet),
          inArray(mcpTradeDelegations.status, ['pending_signer', 'active']),
        ),
      )
      .limit(1);
    if (open?.status === 'active' && !grantExpired(open.expiresAt))
      throw new Error('Wallet already has an active delegation');
    if (open?.status === 'pending_signer' && !grantExpired(open.expiresAt)) {
      if (
        open.id !== owner.delegationId ||
        open.perTradeLimitUsd !== owner.terms.perTradeUsd ||
        open.dailyLimitUsd !== owner.terms.dailyUsd ||
        open.maxSlippageBps !== owner.terms.maxSlippageBps ||
        open.allowSell !== owner.terms.allowSell ||
        (open.expiresAt?.toISOString() ?? null) !== owner.terms.expiresAt
      )
        throw new Error('Pending grant has different signed terms');
      return {
        delegationId: open.id,
        wallet: open.wallet,
        signerId: open.signerId,
        policyId: open.policyId,
        perTradeUsd: open.perTradeLimitUsd,
        dailyUsd: open.dailyLimitUsd,
        maxSlippageBps: open.maxSlippageBps,
        allowSell: open.allowSell,
        expiresAt: open.expiresAt?.toISOString() ?? null,
      };
    }
    if (open && grantExpired(open.expiresAt))
      await this.deps.db
        .update(mcpTradeDelegations)
        .set({ status: 'expired' })
        .where(eq(mcpTradeDelegations.id, open.id));
    const wallet = await this.deps.privy.wallets().get(owner.walletId);
    if (
      wallet.address !== owner.wallet ||
      wallet.chain_type !== 'solana' ||
      !Array.isArray(wallet.additional_signers) ||
      wallet.additional_signers.length !== 0
    )
      throw new Error('Wallet has other signers; enrollment is unavailable');
    const delegation = await this.deps.db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(mcpTradeDelegations)
        .values({
          id: owner.delegationId,
          userId: owner.userId,
          walletId: owner.walletId,
          wallet: owner.wallet,
          signerId: this.config.signerQuorumId,
          policyId: this.config.policyId,
          policyHash: this.config.policyHash,
          policyTier: settings.allowSell ? 2 : 1,
          allowSell: settings.allowSell,
          perTradeLimitUsd: settings.perTradeUsd.toFixed(6),
          dailyLimitUsd: settings.dailyUsd.toFixed(6),
          maxSlippageBps: settings.maxSlippageBps,
          expiresAt,
        })
        .returning();
      await tx.insert(mcpAuditEvents).values({
        userId: owner.userId,
        walletId: owner.walletId,
        delegationId: saved.id,
        eventType: 'delegation_prepared',
        details: { allowSell: settings.allowSell },
      });
      return saved;
    });
    return {
      delegationId: delegation.id,
      wallet: owner.wallet,
      signerId: delegation.signerId,
      policyId: delegation.policyId,
      perTradeUsd: delegation.perTradeLimitUsd,
      dailyUsd: delegation.dailyLimitUsd,
      maxSlippageBps: delegation.maxSlippageBps,
      allowSell: delegation.allowSell,
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  }

  async activateGrant(proof: OwnerProof, delegationId: string) {
    this.assertEnabled();
    const owner = await this.browserOwner(proof, 'activate');
    const [delegation] = await this.deps.db
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.id, delegationId),
          eq(mcpTradeDelegations.userId, owner.userId),
          eq(mcpTradeDelegations.walletId, owner.walletId),
          eq(mcpTradeDelegations.wallet, owner.wallet),
        ),
      )
      .limit(1);
    if (
      delegation?.status === 'active' &&
      !grantExpired(delegation.expiresAt) &&
      sameGrantTerms(owner, delegation)
    ) {
      await this.verifyPrivySigner(delegation);
      return {
        active: true,
        delegationId,
        expiresAt: delegation.expiresAt?.toISOString() ?? null,
      };
    }
    if (
      !delegation ||
      delegation.status !== 'pending_signer' ||
      grantExpired(delegation.expiresAt) ||
      !sameGrantTerms(owner, delegation)
    )
      throw new Error('Pending delegation unavailable');
    await this.verifyPrivySigner(delegation);
    const updated = await this.deps.db.transaction(async (tx) => {
      const [active] = await tx
        .update(mcpTradeDelegations)
        .set({ status: 'active', activatedAt: new Date() })
        .where(
          and(
            eq(mcpTradeDelegations.id, delegation.id),
            eq(mcpTradeDelegations.status, 'pending_signer'),
          ),
        )
        .returning();
      if (!active) throw new Error('Delegation activation changed');
      await tx.insert(mcpAuditEvents).values({
        userId: owner.userId,
        walletId: owner.walletId,
        delegationId,
        eventType: 'delegation_activated',
        details: {},
      });
      return active;
    });
    return {
      active: true,
      delegationId,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
    };
  }

  async revokeGrant(proof: OwnerProof, delegationId: string) {
    const owner = await this.browserOwner(proof, 'revoke', false);
    if (owner.delegationId !== delegationId)
      throw new Error('Revocation targets a different grant');
    await this.deps.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(mcpTradeDelegations)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revokeReason: 'browser_owner',
        })
        .where(
          and(
            eq(mcpTradeDelegations.id, delegationId),
            eq(mcpTradeDelegations.userId, owner.userId),
            eq(mcpTradeDelegations.walletId, owner.walletId),
            eq(mcpTradeDelegations.wallet, owner.wallet),
            inArray(mcpTradeDelegations.status, ['pending_signer', 'active']),
          ),
        )
        .returning({ id: mcpTradeDelegations.id });
      if (!updated) throw new Error('Delegation unavailable');
      await tx.insert(mcpAuditEvents).values({
        userId: owner.userId,
        walletId: owner.walletId,
        delegationId,
        eventType: 'delegation_revoked',
        details: {},
      });
    });
    return { revoked: true, removeAllWalletSignersInBrowser: true };
  }

  private async ownedState(intentId: string) {
    const [intent] = await this.deps.db
      .select()
      .from(mcpTradeIntents)
      .where(eq(mcpTradeIntents.id, intentId))
      .limit(1);
    if (!intent || !intent.delegationId || intent.mode !== 'delegated')
      throw new Error('Delegated intent unavailable');
    const [delegation] = await this.deps.db
      .select()
      .from(mcpTradeDelegations)
      .where(
        and(
          eq(mcpTradeDelegations.id, intent.delegationId),
          eq(mcpTradeDelegations.userId, intent.userId),
          eq(mcpTradeDelegations.wallet, intent.wallet),
        ),
      )
      .limit(1);
    if (
      !delegation ||
      delegation.status !== 'active' ||
      grantExpired(delegation.expiresAt) ||
      !delegatedUserAllowed(this.config, intent.userId) ||
      (intent.side === 'buy' && !this.config.buysEnabled) ||
      (intent.side === 'sell' &&
        (!this.config.sellsEnabled || !delegation.allowSell)) ||
      (delegation.expiresAt !== null &&
        delegation.expiresAt.getTime() - delegation.createdAt.getTime() >
          MAX_GRANT_MS)
    )
      throw new Error('Delegation is inactive or exceeds owner-only limits');
    const [connection] = await this.deps.db
      .select()
      .from(mcpConnections)
      .where(
        and(
          eq(mcpConnections.grantId, intent.grantId),
          eq(mcpConnections.clientId, intent.clientId),
          eq(mcpConnections.userId, intent.userId),
          eq(mcpConnections.walletId, delegation.walletId),
          eq(mcpConnections.wallet, intent.wallet),
          isNull(mcpConnections.revokedAt),
        ),
      )
      .limit(1);
    if (
      !connection ||
      !connection.scopes.split(/\s+/).includes('oren.trade.execute') ||
      !delegation.activatedAt ||
      connection.createdAt <= delegation.activatedAt
    )
      throw new Error('A newly consented execute connection is required');
    await this.deps.auth.verifyMcpWallet(
      intent.userId,
      delegation.walletId,
      intent.wallet,
    );
    const policy = await this.verifyPrivySigner(
      delegation,
      intent.stockMint ?? undefined,
    );
    return { intent, delegation, policy };
  }

  private async verifyPrivySigner(delegation: Delegation, stockMint?: string) {
    if (
      delegation.signerId !== this.config.signerQuorumId ||
      delegation.policyId !== this.config.policyId ||
      delegation.policyHash !== this.config.policyHash
    )
      throw new Error(
        'Delegated signer or policy differs from the gate configuration',
      );
    const wallet = await this.deps.privy.wallets().get(delegation.walletId);
    if (
      wallet.address !== delegation.wallet ||
      wallet.chain_type !== 'solana' ||
      wallet.additional_signers?.length !== 1 ||
      wallet.additional_signers[0].signer_id !== delegation.signerId ||
      wallet.additional_signers[0].override_policy_ids?.length !== 1 ||
      wallet.additional_signers[0].override_policy_ids[0] !==
        delegation.policyId
    )
      throw new Error('Privy wallet signer state changed');
    const policy = await this.deps.privy.policies().get(delegation.policyId);
    if (
      policy.owner_id !== this.config.policyOwnerId ||
      policy.chain_type !== 'solana' ||
      gatePolicyFingerprint(policy) !== this.config.policyHash ||
      !gatePolicyRulesValid(policy, this.config.sellsEnabled)
    )
      throw new Error('Privy signer policy changed');
    if (stockMint && !policyAllowsStock(policy, stockMint))
      throw new Error('Stock mint is outside the delegated policy allowlist');
    const limits = grantSpendLimits(policy, this.config.sellsEnabled);
    if (
      usdMicros(delegation.perTradeLimitUsd) >
        usdMicros(limits.maxPerTradeUsd.toFixed(6)) ||
      usdMicros(delegation.dailyLimitUsd) >
        usdMicros(limits.maxDailyUsd.toFixed(6))
    )
      throw new Error('Grant exceeds the signing policy spend limits');
    return policy;
  }

  private response(execution: Execution) {
    return {
      executionId: execution.id,
      state: execution.state,
      ...(execution.state === 'challenged' &&
      execution.requestExpiresAt > new Date()
        ? { canonicalRequestBase64: canonical(execution).toString('base64') }
        : {}),
      chainSignature: execution.chainSignature ?? undefined,
      ...signingOutcome(execution.errorCode, execution.chainSignature),
      ...(execution.errorCode === 'slippage_requote'
        ? { slippageRequoted: true }
        : {}),
    };
  }

  async challenge(intentId: string, idempotencyKey: string) {
    this.assertEnabled();
    if (
      !/^[a-f\d-]{36}$/i.test(intentId) ||
      !/^[A-Za-z0-9_-]{16,64}$/.test(idempotencyKey)
    )
      throw new Error('Invalid intent or idempotency key');
    const { intent, delegation, policy } = await this.ownedState(intentId);
    const [existing] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.intentId, intentId))
      .limit(1);
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey)
        throw new Error('Intent was already claimed with another key');
      return this.reconcile(existing.id);
    }
    // One fresh quote at the intent's original slippage. Never a wider limit.
    const built = await retryOnceOnSlippage(() =>
      buildGateJupiterRoute(intent, this.deps),
    );
    const fresh = built.value;
    if (
      fresh.createsDestinationAccount &&
      !policyAllowsDestinationAccount(
        policy,
        intent.side === 'buy' ? intent.stockMint! : USDC_MINT,
      )
    )
      throw new Error(
        'Destination account creation is outside the delegated policy',
      );
    const requestExpiresAt = new Date(Date.now() + 30_000);
    const executionId = randomUUID();
    const request = this.deps.auth.signingRequest(
      delegation.walletId,
      fresh.transaction,
      executionId,
      requestExpiresAt,
    );
    const reserved = await reserveTradeBudget(this.deps.db, {
      delegationId: delegation.id,
      intentId: intent.id,
      grantId: intent.grantId,
      clientId: intent.clientId,
      userId: intent.userId,
      walletId: delegation.walletId,
      wallet: intent.wallet,
      idempotencyKey,
      rawInput: fresh.rawInput,
      referenceValueUsd: fresh.referenceValueUsd,
      quotedProceedsUsd: fresh.quotedProceedsUsd,
      execution: {
        id: executionId,
        intentId,
        idempotencyKey,
        unsignedTransaction: fresh.transaction,
        privyRequest: request,
        requestExpiresAt,
        lastValidBlockHeight: fresh.lastValidBlockHeight,
        ...(built.retried ? { errorCode: 'slippage_requote' } : {}),
      },
    });
    if (reserved.status !== 'reserved') {
      if (reserved.status === 'existing') {
        const [existingAfterRace] = await this.deps.db
          .select()
          .from(mcpDelegatedExecutions)
          .where(eq(mcpDelegatedExecutions.intentId, intentId))
          .limit(1);
        if (
          existingAfterRace &&
          existingAfterRace.idempotencyKey === idempotencyKey
        )
          return this.response(existingAfterRace);
        throw new Error('Claim exists without a matching execution');
      }
      throw new Error(`Delegated trade ${reserved.status}`);
    }
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId));
    if (!execution) throw new Error('Execution storage unavailable');
    return this.response(execution);
  }

  /**
   * Replace one unsigned challenge with a fresh quote at the same slippage.
   * Refuses a second replacement. The caller supplies only an execution id.
   */
  async slippageRetry(executionId: string) {
    this.assertEnabled();
    if (!/^[a-f\d-]{36}$/i.test(executionId))
      throw new Error('Invalid execution');
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (
      !execution ||
      execution.state !== 'challenged' ||
      execution.signedTransaction ||
      execution.chainSignature ||
      execution.requestExpiresAt <= new Date()
    )
      throw new Error('Unsigned challenge unavailable');
    if (execution.errorCode === 'slippage_requote')
      throw new BadRequestException({
        message: slippageExceededMessage(),
        code: 'QUOTE_SLIPPAGE_EXCEEDED',
      });
    const { intent, delegation, policy } = await this.ownedState(
      execution.intentId,
    );
    if (intent.status !== 'executing')
      throw new Error('Prepared intent is unavailable for delegation');
    const fresh = await buildGateJupiterRoute(intent, this.deps, {
      allowExecuting: true,
    });
    if (
      fresh.createsDestinationAccount &&
      !policyAllowsDestinationAccount(
        policy,
        intent.side === 'buy' ? intent.stockMint! : USDC_MINT,
      )
    )
      throw new Error(
        'Destination account creation is outside the delegated policy',
      );
    const charge = reservationNotionalUsd(intent, fresh);
    const [reservation] = await this.deps.db
      .select()
      .from(mcpBudgetReservations)
      .where(eq(mcpBudgetReservations.intentId, intent.id))
      .limit(1);
    if (
      !charge ||
      !reservation ||
      reservation.status !== 'reserved' ||
      usdMicros(charge) > usdMicros(reservation.amountUsd)
    )
      throw new Error('Delegated trade over_budget');
    const requestExpiresAt = new Date(Date.now() + 30_000);
    const request = this.deps.auth.signingRequest(
      delegation.walletId,
      fresh.transaction,
      execution.id,
      requestExpiresAt,
    );
    const [updated] = await this.deps.db
      .update(mcpDelegatedExecutions)
      .set({
        unsignedTransaction: fresh.transaction,
        privyRequest: request,
        requestExpiresAt,
        lastValidBlockHeight: fresh.lastValidBlockHeight ?? null,
        errorCode: 'slippage_requote',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mcpDelegatedExecutions.id, execution.id),
          eq(mcpDelegatedExecutions.state, 'challenged'),
          isNull(mcpDelegatedExecutions.signedTransaction),
          isNull(mcpDelegatedExecutions.chainSignature),
          isNull(mcpDelegatedExecutions.errorCode),
        ),
      )
      .returning();
    if (!updated) throw new Error('Unsigned challenge unavailable');
    return this.response(updated);
  }

  /** Release an unsigned challenge after slippage still fails. Never touches signed bytes. */
  async abortUnsigned(executionId: string) {
    this.assertEnabled();
    if (!/^[a-f\d-]{36}$/i.test(executionId))
      throw new Error('Invalid execution');
    const aborted = await this.deps.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(mcpDelegatedExecutions)
        .set({
          state: 'failed',
          errorCode: 'slippage_exceeded',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpDelegatedExecutions.id, executionId),
            eq(mcpDelegatedExecutions.state, 'challenged'),
            isNull(mcpDelegatedExecutions.signedTransaction),
            isNull(mcpDelegatedExecutions.chainSignature),
          ),
        )
        .returning({ intentId: mcpDelegatedExecutions.intentId });
      if (!claimed) return false;
      await tx
        .update(mcpBudgetReservations)
        .set({ status: 'released', settledAt: new Date() })
        .where(
          and(
            eq(mcpBudgetReservations.intentId, claimed.intentId),
            eq(mcpBudgetReservations.status, 'reserved'),
          ),
        );
      await tx
        .update(mcpTradeIntents)
        .set({ status: 'failed', executionError: 'slippage_exceeded' })
        .where(eq(mcpTradeIntents.id, claimed.intentId));
      return true;
    });
    return { aborted, executionId, reason: 'slippage_exceeded' as const };
  }

  async complete(executionId: string, apiSignatureBase64: string) {
    this.assertEnabled();
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new Error('Execution unavailable');
    if (execution.state !== 'challenged') return this.response(execution);
    if (execution.requestExpiresAt <= new Date())
      throw new Error('Challenge expired; reconcile the reservation');
    const key = createPublicKey({
      key: Buffer.from(this.config.apiPublicKeyDerBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (
      key.asymmetricKeyType !== 'ec' ||
      key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      !verify(
        'sha256',
        canonical(execution),
        key,
        Buffer.from(apiSignatureBase64, 'base64'),
      )
    )
      throw new Error('API authorization signature is invalid');
    const { delegation } = await this.ownedState(execution.intentId);
    const requestUrl = execution.privyRequest.url;
    if (
      typeof requestUrl !== 'string' ||
      requestUrl !==
        `https://api.privy.io/v1/wallets/${encodeURIComponent(delegation.walletId)}/rpc`
    )
      throw new Error('Privy request wallet changed');
    const [claimed] = await this.deps.db
      .update(mcpDelegatedExecutions)
      .set({ state: 'signing', updatedAt: new Date() })
      .where(
        and(
          eq(mcpDelegatedExecutions.id, executionId),
          eq(mcpDelegatedExecutions.state, 'challenged'),
        ),
      )
      .returning();
    if (!claimed) return { executionId, state: 'pending' as const };
    const gateSignature = generateAuthorizationSignature({
      authorizationPrivateKey: this.config.gatePrivateKeyDerBase64,
      input: canonical(claimed),
    });
    let signed: string;
    try {
      const result = await this.deps.privy
        .wallets()
        .solana()
        .signTransaction(delegation.walletId, {
          transaction: execution.unsignedTransaction,
          authorization_context: {
            signatures: [apiSignatureBase64, gateSignature],
          },
          idempotency_key: execution.id,
          request_expiry: execution.requestExpiresAt.getTime(),
        });
      signed = result.signed_transaction;
    } catch (error) {
      const failure = signingFailureDetails(error);
      console.error(
        'Privy delegated signing failed',
        JSON.stringify({ executionId: execution.id, ...failure }),
      );
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({
          state: 'pending',
          errorCode: failure.errorCode,
          updatedAt: new Date(),
        })
        .where(eq(mcpDelegatedExecutions.id, execution.id));
      return {
        executionId,
        state: 'pending' as const,
        ...signingOutcome(failure.errorCode),
      };
    }
    const chainSignature = this.deps.rpc.validateSigned(
      execution.unsignedTransaction,
      signed,
      delegation.wallet,
    );
    await this.deps.db
      .update(mcpDelegatedExecutions)
      .set({
        state: 'signed',
        signedTransaction: signed,
        chainSignature,
        updatedAt: new Date(),
      })
      .where(eq(mcpDelegatedExecutions.id, execution.id));
    return this.broadcast(execution.id);
  }

  private async broadcast(executionId: string) {
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (!execution?.signedTransaction || !execution.chainSignature)
      throw new Error('Signed bytes have not been persisted');
    try {
      await this.deps.rpc.broadcast(execution.signedTransaction);
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({ state: 'broadcast', updatedAt: new Date() })
        .where(eq(mcpDelegatedExecutions.id, executionId));
      await this.deps.db
        .update(mcpTradeIntents)
        .set({ status: 'submitted' })
        .where(eq(mcpTradeIntents.id, execution.intentId));
      return {
        executionId,
        state: 'broadcast' as const,
        chainSignature: execution.chainSignature,
      };
    } catch {
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({
          state: 'pending',
          errorCode: 'broadcast_uncertain',
          updatedAt: new Date(),
        })
        .where(eq(mcpDelegatedExecutions.id, executionId));
      return {
        executionId,
        state: 'pending' as const,
        chainSignature: execution.chainSignature,
      };
    }
  }

  async reconcile(executionId: string) {
    const [execution] = await this.deps.db
      .select()
      .from(mcpDelegatedExecutions)
      .where(eq(mcpDelegatedExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new Error('Execution unavailable');
    let expiredUnsignedSigning = false;
    if (
      execution.state === 'pending' &&
      !execution.chainSignature &&
      !execution.signedTransaction &&
      execution.requestExpiresAt <= new Date() &&
      (execution.errorCode === 'privy_uncertain' ||
        /^privy_rejected_(400|401|403|404|409|422)$/.test(
          execution.errorCode ?? '',
        )) &&
      Number.isSafeInteger(execution.lastValidBlockHeight) &&
      execution.lastValidBlockHeight! > 0
    ) {
      const [intent] = await this.deps.db
        .select({ wallet: mcpTradeIntents.wallet })
        .from(mcpTradeIntents)
        .where(eq(mcpTradeIntents.id, execution.intentId))
        .limit(1);
      expiredUnsignedSigning =
        !!intent &&
        !(await this.deps.rpc.blockhashValid(
          execution.unsignedTransaction,
          intent.wallet,
          execution.lastValidBlockHeight!,
        ));
    }
    if (
      (execution.state === 'challenged' &&
        execution.requestExpiresAt <= new Date()) ||
      expiredUnsignedSigning
    ) {
      const expired = await this.deps.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(mcpDelegatedExecutions)
          .set({
            state: 'failed',
            errorCode: expiredUnsignedSigning
              ? 'signing_expired'
              : 'unused_challenge_expired',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mcpDelegatedExecutions.id, executionId),
              eq(
                mcpDelegatedExecutions.state,
                expiredUnsignedSigning ? 'pending' : 'challenged',
              ),
              ...(expiredUnsignedSigning
                ? [
                    isNull(mcpDelegatedExecutions.chainSignature),
                    isNull(mcpDelegatedExecutions.signedTransaction),
                  ]
                : []),
            ),
          )
          .returning({ id: mcpDelegatedExecutions.id });
        if (!claimed) return false;
        await tx
          .update(mcpBudgetReservations)
          .set({ status: 'released', settledAt: new Date() })
          .where(
            and(
              eq(mcpBudgetReservations.intentId, execution.intentId),
              eq(mcpBudgetReservations.status, 'reserved'),
            ),
          );
        await tx
          .update(mcpTradeIntents)
          .set({ status: 'failed' })
          .where(eq(mcpTradeIntents.id, execution.intentId));
        return true;
      });
      if (expired) return { executionId, state: 'failed' as const };
      return { executionId, state: 'pending' as const };
    }
    if (!execution.chainSignature) return this.response(execution);
    const status = await this.deps.rpc.status(execution.chainSignature);
    if (
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      if (status.err) {
        await settleTradeBudget(
          this.deps.db,
          execution.intentId,
          'definite_failure',
        );
        await this.deps.db
          .update(mcpDelegatedExecutions)
          .set({
            state: 'failed',
            errorCode: 'chain_failure',
            updatedAt: new Date(),
          })
          .where(eq(mcpDelegatedExecutions.id, executionId));
        return { executionId, state: 'failed' as const };
      }
      await settleTradeBudget(this.deps.db, execution.intentId, 'confirmed');
      await this.deps.db
        .update(mcpDelegatedExecutions)
        .set({ state: 'confirmed', updatedAt: new Date() })
        .where(eq(mcpDelegatedExecutions.id, executionId));
      return {
        executionId,
        state: 'confirmed' as const,
        chainSignature: execution.chainSignature,
      };
    }
    const [intent] = await this.deps.db
      .select({ wallet: mcpTradeIntents.wallet })
      .from(mcpTradeIntents)
      .where(eq(mcpTradeIntents.id, execution.intentId));
    if (
      execution.signedTransaction &&
      execution.lastValidBlockHeight &&
      intent &&
      (await this.deps.rpc.blockhashValid(
        execution.signedTransaction,
        intent.wallet,
        execution.lastValidBlockHeight,
      ))
    )
      return this.broadcast(executionId);
    return {
      executionId,
      state: 'pending' as const,
      chainSignature: execution.chainSignature,
    };
  }
}
