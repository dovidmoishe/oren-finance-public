import { generateAuthorizationSignature } from '@privy-io/node';
import { SignerGateRejection } from './signer-gate.errors';
import type { ApiTradeAuthorizer, TradeActor } from './api-trade-authorization';
import type { OwnerProof } from './grant-owner-proof';
import {
  isSlippageSimulationError,
  simulationGateCode,
} from '../execution/simulation-reason';

export type GateResult = {
  executionId: string;
  state: string;
  chainSignature?: string;
  submissionState?: string;
  reason?: string;
  message?: string;
  slippageRequoted?: boolean;
};

/** MCP API holds only one Privy quorum key; the gate holds the other. */
export class SignerGateClient {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly apiPrivateKey: string,
    private readonly authorizer?: ApiTradeAuthorizer,
  ) {
    if (!/^http:\/\/signer-gate:3001$/.test(url))
      throw new Error(
        'Signer gate must use the private production container address',
      );
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new SignerGateRejection(result.error ?? 'unavailable');
    return result;
  }

  async execute(
    intentId: string,
    idempotencyKey: string,
    actor?: TradeActor,
  ): Promise<GateResult> {
    if (!this.apiPrivateKey || !this.authorizer || !actor)
      throw new SignerGateRejection('disabled');
    const challenge = await this.post<
      GateResult & { canonicalRequestBase64?: string }
    >('/challenge', { intentId, idempotencyKey });
    return this.finishWithSlippageRetry(
      challenge,
      intentId,
      idempotencyKey,
      actor,
    );
  }

  private async finishWithSlippageRetry(
    challenge: GateResult & { canonicalRequestBase64?: string },
    intentId: string,
    idempotencyKey: string,
    actor: TradeActor,
  ): Promise<GateResult> {
    try {
      return await this.finish(challenge, intentId, idempotencyKey, actor);
    } catch (error) {
      if (!isSlippageSimulationError(error)) classifyTradeError(error);
      if (challenge.slippageRequoted || challenge.state !== 'challenged') {
        await this.abortUnsigned(challenge.executionId);
        throw new SignerGateRejection('slippage_exceeded');
      }
      let rebuilt: GateResult & { canonicalRequestBase64?: string };
      try {
        rebuilt = await this.post('/slippage-retry', {
          executionId: challenge.executionId,
        });
      } catch (retryError) {
        await this.abortUnsigned(challenge.executionId);
        if (
          retryError instanceof SignerGateRejection &&
          retryError.code === 'slippage_exceeded'
        )
          throw retryError;
        classifyTradeError(retryError);
      }
      try {
        return await this.finish(rebuilt, intentId, idempotencyKey, actor);
      } catch (again) {
        if (!isSlippageSimulationError(again)) classifyTradeError(again);
        await this.abortUnsigned(rebuilt.executionId);
        throw new SignerGateRejection('slippage_exceeded');
      }
    }
  }

  private async finish(
    challenge: GateResult & { canonicalRequestBase64?: string },
    intentId: string,
    idempotencyKey: string,
    actor: TradeActor,
  ): Promise<GateResult> {
    if (challenge.state !== 'challenged') return challenge;
    if (!challenge.canonicalRequestBase64)
      throw new SignerGateRejection('pending');
    const independentlyAuthorized = await this.authorizer!.authorize(
      intentId,
      idempotencyKey,
      actor,
      challenge,
    );
    const signature = generateAuthorizationSignature({
      authorizationPrivateKey: this.apiPrivateKey,
      input: independentlyAuthorized,
    });
    return this.post<GateResult>('/complete', {
      executionId: challenge.executionId,
      apiSignatureBase64: signature,
    });
  }

  private async abortUnsigned(executionId: string) {
    try {
      await this.post('/abort-unsigned', { executionId });
    } catch {
      /* The caller still reports the slippage failure. */
    }
  }

  grantLimits() {
    return this.post<{
      maxDurationHours?: number;
      untilRevoked?: boolean;
      spendLimits?: { maxPerTradeUsd: number; maxDailyUsd: number };
    }>('/grant/limits', {});
  }

  prepareGrant(
    authorization: OwnerProof,
    settings: {
      allowSell: boolean;
      perTradeUsd: number;
      dailyUsd: number;
      maxSlippageBps: number;
      durationHours: number | null;
    },
  ) {
    return this.post<{
      delegationId: string;
      wallet: string;
      signerId: string;
      policyId: string;
      perTradeUsd: string;
      dailyUsd: string;
      maxSlippageBps: number;
      allowSell: boolean;
      expiresAt: string | null;
    }>('/grant/prepare', { authorization, ...settings });
  }

  activateGrant(authorization: OwnerProof, delegationId: string) {
    return this.post<{
      active: boolean;
      delegationId: string;
      expiresAt: string | null;
    }>('/grant/activate', { authorization, delegationId });
  }

  revokeGrant(authorization: OwnerProof, delegationId: string) {
    return this.post<{
      revoked: boolean;
      removeAllWalletSignersInBrowser: boolean;
    }>('/grant/revoke', { authorization, delegationId });
  }
}

function classifyTradeError(error: unknown): never {
  if (error instanceof SignerGateRejection) throw error;
  if (
    error instanceof Error &&
    (error.message === 'Independent trade authorization is inactive' ||
      error.message === 'Delegated trade inactive' ||
      error.message === 'Delegation is inactive or exceeds owner-only limits')
  )
    throw new SignerGateRejection('inactive_delegation');
  const code = simulationGateCode(error);
  if (code) throw new SignerGateRejection(code);
  if (error instanceof Error) throw error;
  throw new Error('Trade authorization failed');
}
