import { Injectable } from '@nestjs/common';
import type {
  AlchemyProvider,
  TokenAccount,
  TokenBalance,
  TransactionStatus,
  WalletTransaction,
} from '../../types/providers/alchemy-provider';
import { AlchemyClient } from './alchemy.client';
import type {
  AlchemySignatureInfo,
  AlchemyTokenAccountRaw,
  AlchemyParsedTransaction,
  AlchemyRawTransaction,
} from './alchemy.types';

@Injectable()
export class AlchemyService implements AlchemyProvider {
  constructor(private readonly client: AlchemyClient) {}

  async getTokenBalances(wallet: string): Promise<TokenBalance[]> {
    const accounts = await this.getTokenAccounts(wallet);
    return accounts.map((a) => ({
      mint: a.mint,
      amount: a.amount,
      decimals: a.decimals,
      uiAmount: a.uiAmount,
      programId: a.programId,
    }));
  }

  async getTokenAccounts(wallet: string): Promise<TokenAccount[]> {
    const result = await this.client.call<{
      value?: AlchemyTokenAccountRaw[];
    }>('getTokenAccountsByOwner', [
      wallet,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ]);

    const value = result?.value ?? [];
    const accounts: TokenAccount[] = [];

    for (const item of value) {
      const info = item.account?.data?.parsed?.info;
      const tokenAmount = info?.tokenAmount;
      if (!info?.mint || !tokenAmount) continue;
      const amount = Number(tokenAmount.amount ?? 0);
      const decimals = tokenAmount.decimals ?? 0;
      const uiAmount =
        tokenAmount.uiAmount ??
        (decimals > 0 ? amount / 10 ** decimals : amount);
      if (!uiAmount || uiAmount <= 0) continue;
      accounts.push({
        address: item.pubkey ?? '',
        mint: info.mint,
        owner: info.owner ?? wallet,
        amount,
        decimals,
        uiAmount,
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      });
    }

    // Also try Token-2022 program
    try {
      const result2022 = await this.client.call<{
        value?: AlchemyTokenAccountRaw[];
      }>('getTokenAccountsByOwner', [
        wallet,
        { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
        { encoding: 'jsonParsed' },
      ]);
      for (const item of result2022?.value ?? []) {
        const info = item.account?.data?.parsed?.info;
        const tokenAmount = info?.tokenAmount;
        if (!info?.mint || !tokenAmount) continue;
        const amount = Number(tokenAmount.amount ?? 0);
        const decimals = tokenAmount.decimals ?? 0;
        const uiAmount =
          tokenAmount.uiAmount ??
          (decimals > 0 ? amount / 10 ** decimals : amount);
        if (!uiAmount || uiAmount <= 0) continue;
        accounts.push({
          address: item.pubkey ?? '',
          mint: info.mint,
          owner: info.owner ?? wallet,
          amount,
          decimals,
          uiAmount,
          programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        });
      }
    } catch {
      // Token-2022 optional
    }

    return accounts;
  }

  async getTransactionHistory(
    wallet: string,
    options?: { limit?: number; before?: string },
  ): Promise<WalletTransaction[]> {
    const params: unknown[] = [
      wallet,
      {
        limit: options?.limit ?? 20,
        ...(options?.before ? { before: options.before } : {}),
      },
    ];
    const sigs = await this.client.call<AlchemySignatureInfo[]>(
      'getSignaturesForAddress',
      params,
    );

    return (sigs ?? []).map((s) => ({
      signature: s.signature ?? '',
      slot: s.slot,
      blockTime: s.blockTime ? new Date(s.blockTime * 1000) : undefined,
      status: this.mapConfirmationStatus(s.confirmationStatus, s.err),
      err: s.err ?? undefined,
    }));
  }

  async getTransaction(signature: string): Promise<WalletTransaction | null> {
    const tx = await this.getParsedTransaction(signature);

    if (!tx) return null;

    return {
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : undefined,
      status: tx.meta?.err ? 'failed' : 'finalized',
      feeSol: tx.meta?.fee !== undefined ? tx.meta.fee / 1e9 : undefined,
      err: tx.meta?.err ?? undefined,
    };
  }

  async getParsedTransaction(
    signature: string,
  ): Promise<AlchemyParsedTransaction | null> {
    return this.client.call<AlchemyParsedTransaction | null>('getTransaction', [
      signature,
      {
        encoding: 'jsonParsed',
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      },
    ]);
  }

  /** Account bytes at confirmed commitment, or null when the account is absent. */
  async getAccountData(address: string): Promise<Buffer | null> {
    const result = await this.client.call<{
      value?: { data?: [string, string] | string } | null;
    } | null>('getAccountInfo', [
      address,
      { encoding: 'base64', commitment: 'confirmed' },
    ]);
    const data = result?.value?.data;
    if (!data) return null;
    const encoded = Array.isArray(data) ? data[0] : data;
    if (!encoded) return null;
    return Buffer.from(encoded, 'base64');
  }

  /** Exact transaction bytes at confirmed commitment, for verifying who signed what. */
  async getConfirmedRawTransaction(
    signature: string,
  ): Promise<AlchemyRawTransaction | null> {
    return this.client.call<AlchemyRawTransaction | null>('getTransaction', [
      signature,
      {
        encoding: 'base64',
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      },
    ]);
  }

  async getTransactionStatus(signature: string): Promise<TransactionStatus> {
    const statuses = await this.client.call<
      Array<{
        confirmationStatus?: string | null;
        err?: unknown;
        confirmations?: number | null;
      } | null>
    >('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);

    const status = statuses?.[0];
    if (!status) return 'unknown';
    return this.mapConfirmationStatus(status.confirmationStatus, status.err);
  }

  async getSolBalance(wallet: string): Promise<number> {
    const lamports = await this.client.call<number>('getBalance', [wallet]);
    return (lamports ?? 0) / 1e9;
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    await this.client.call<string>('getHealth', []);
    return { ok: true, latencyMs: Date.now() - start };
  }

  private mapConfirmationStatus(
    confirmationStatus?: string | null,
    err?: unknown,
  ): TransactionStatus {
    if (err) return 'failed';
    switch (confirmationStatus) {
      case 'processed':
        return 'pending';
      case 'confirmed':
        return 'confirmed';
      case 'finalized':
        return 'finalized';
      default:
        return confirmationStatus ? 'pending' : 'unknown';
    }
  }
}
