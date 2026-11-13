import { assertFinancialExecutionEnabled } from '../config/deployment';
import {
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrivyClient } from '@privy-io/node';

/** Verifies both the session and the wallet's current association with that user. */
export class PrivyWalletAuth {
  private readonly logger = new Logger(PrivyWalletAuth.name);
  private readonly client?: PrivyClient;

  constructor(
    private readonly appId?: string,
    appSecret?: string,
  ) {
    if (appId && appSecret) this.client = new PrivyClient({ appId, appSecret });
  }

  private async verifiedUser(authorization: string | undefined) {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException('Authentication required');

    let userId: string;
    try {
      const claims = await this.client
        .utils()
        .auth()
        .verifyAccessToken(match[1]);
      userId = claims.user_id;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    let user: Awaited<ReturnType<ReturnType<PrivyClient['users']>['_get']>>;
    try {
      user = await this.client.users()._get(userId);
    } catch {
      throw new ServiceUnavailableException(
        'Unable to verify wallet ownership',
      );
    }
    return { userId, user };
  }

  async requireWallet(
    authorization: string | undefined,
    wallet: string,
  ): Promise<string> {
    const { userId, user } = await this.verifiedUser(authorization);
    if (
      !user.linked_accounts.some(
        (account) =>
          account.type === 'wallet' &&
          account.chain_type === 'solana' &&
          account.address === wallet,
      )
    )
      throw new ForbiddenException('Wallet is not linked to this account');
    return userId;
  }

  async requireResearchIdentity(
    authorization: string | undefined,
    wallet: string,
  ) {
    const { userId, user } = await this.verifiedUser(authorization);
    const linked = user.linked_accounts.some(
      (account) =>
        account.type === 'wallet' &&
        account.chain_type === 'solana' &&
        account.address === wallet,
    );
    if (!linked)
      throw new ForbiddenException('Wallet is not linked to this account');
    return { userId, walletAddress: wallet, email: emailFromPrivyUser(user) };
  }

  async requireMcpUser(authorization: string | undefined): Promise<string> {
    return (await this.verifiedUser(authorization)).userId;
  }

  /**
   * Best-effort session identity for feature allowlists. A missing or invalid
   * token returns undefined so public agent chat keeps working.
   */
  async tryIdentify(
    authorization: string | undefined,
  ): Promise<{ userId: string; email?: string } | undefined> {
    if (!authorization?.trim()) return undefined;
    try {
      const { userId, user } = await this.verifiedUser(authorization);
      const email = emailFromPrivyUser(user);
      return email ? { userId, email } : { userId };
    } catch {
      return undefined;
    }
  }

  /** Browser OTP session identity for OAuth consent; never returns the token. */
  async requireMcpIdentity(authorization: string | undefined) {
    const { userId, user } = await this.verifiedUser(authorization);
    const account = user.linked_accounts.find(
      (item) =>
        item.type === 'wallet' &&
        item.chain_type === 'solana' &&
        item.wallet_client_type === 'privy' &&
        'id' in item &&
        Boolean(item.id),
    );
    if (
      !account ||
      account.type !== 'wallet' ||
      !('id' in account) ||
      !account.id
    )
      throw new ForbiddenException('An embedded Solana wallet is required');
    const wallet = await this.client!.wallets()
      .get(account.id)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (wallet.chain_type !== 'solana' || wallet.address !== account.address)
      throw new ForbiddenException('Wallet ownership could not be verified');
    return { userId, walletId: account.id, wallet: wallet.address };
  }

  /** Recheck the exact wallet linked at consent on every MCP resource request. */
  async verifyMcpWallet(userId: string, walletId: string, wallet: string) {
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    const user = await this.client
      .users()
      ._get(userId)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    const linked = user.linked_accounts.some(
      (account) =>
        account.type === 'wallet' &&
        account.chain_type === 'solana' &&
        account.wallet_client_type === 'privy' &&
        account.address === wallet &&
        'id' in account &&
        account.id === walletId,
    );
    if (!linked) throw new ForbiddenException('Wallet is no longer linked');
    const owned = await this.client
      .wallets()
      .get(walletId)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (owned.chain_type !== 'solana' || owned.address !== wallet)
      throw new ForbiddenException('Wallet ownership could not be verified');
  }

  async requireSigner(authorization: string | undefined, wallet: string) {
    const { userId, user } = await this.verifiedUser(authorization);
    const account = user.linked_accounts.find(
      (item) =>
        item.type === 'wallet' &&
        item.chain_type === 'solana' &&
        item.address === wallet,
    );
    if (
      !account ||
      account.type !== 'wallet' ||
      account.wallet_client_type !== 'privy' ||
      !('id' in account) ||
      !account.id
    ) {
      throw new ForbiddenException(
        'This wallet is not available for server-side signing',
      );
    }
    const owned = await this.client!.wallets()
      .get(account.id)
      .catch(() => {
        throw new ServiceUnavailableException(
          'Unable to verify wallet ownership',
        );
      });
    if (owned.address !== wallet || owned.chain_type !== 'solana')
      throw new ForbiddenException('Wallet ownership could not be verified');
    return {
      userId,
      walletId: account.id,
      token: /^Bearer\s+(\S+)$/i.exec(authorization!)![1],
    };
  }

  signingRequest(
    walletId: string,
    transaction: string,
    approvalId: string,
    expiresAt: Date,
  ) {
    if (!this.appId)
      throw new ServiceUnavailableException('Authentication is not configured');
    return {
      version: 1 as const,
      method: 'POST' as const,
      url: `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}/rpc`,
      body: {
        method: 'signTransaction',
        chain_type: 'solana',
        params: { transaction, encoding: 'base64' },
      },
      headers: {
        'privy-app-id': this.appId,
        'privy-idempotency-key': approvalId,
        'privy-request-expiry': String(expiresAt.getTime()),
      },
    };
  }

  async signTransaction(
    walletId: string,
    authorizationSignature: string,
    transaction: string,
    approvalId: string,
    expiresAt: Date,
  ) {
    assertFinancialExecutionEnabled();
    if (!this.client)
      throw new ServiceUnavailableException('Authentication is not configured');
    try {
      const result = await this.client
        .wallets()
        .solana()
        .signTransaction(walletId, {
          transaction,
          authorization_context: { signatures: [authorizationSignature] },
          idempotency_key: approvalId,
          request_expiry: expiresAt.getTime(),
        });
      return result.signed_transaction;
    } catch (error) {
      // SDK errors may contain request data; never propagate user JWTs or credentials.
      const failure = error as {
        name?: unknown;
        status?: unknown;
        headers?: { get?: (name: string) => string | null };
        error?: { code?: unknown };
      };
      const status =
        typeof failure?.status === 'number' ? failure.status : 'unknown';
      const safe = (value: unknown) =>
        typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)
          ? value
          : 'unknown';
      const code = safe(failure?.error?.code);
      const requestId = safe(failure?.headers?.get?.('x-request-id'));
      this.logger.warn(
        `Privy sign-only request failed: approval=${safe(approvalId)} status=${status} code=${code} requestId=${requestId} type=${safe(failure?.name)}`,
      );
      throw new ServiceUnavailableException({
        message:
          'Privy could not authorize this trade. No transaction was submitted. Sign in again and review a fresh quote.',
        code: 'PRIVY_SIGNING_FAILED',
        submissionState: 'not_submitted',
      });
    }
  }
}

function emailFromPrivyUser(user: unknown): string | undefined {
  if (!user || typeof user !== 'object') return undefined;
  const record = user as {
    email?: { address?: unknown };
    linked_accounts?: unknown;
  };
  const direct = record.email?.address;
  if (typeof direct === 'string' && direct.includes('@')) return direct.trim();
  if (!Array.isArray(record.linked_accounts)) return undefined;
  for (const account of record.linked_accounts) {
    if (!account || typeof account !== 'object') continue;
    const linked = account as { type?: unknown; address?: unknown };
    if (
      linked.type === 'email' &&
      typeof linked.address === 'string' &&
      linked.address.includes('@')
    ) {
      return linked.address.trim();
    }
  }
  return undefined;
}
