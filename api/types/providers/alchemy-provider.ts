/**
 * Alchemy Solana wallet / indexing surface.
 * Provides raw wallet state; Tokens API resolves mints → canonical equities.
 */
export interface AlchemyProvider {
  getTokenBalances(wallet: string): Promise<TokenBalance[]>;

  getTokenAccounts(wallet: string): Promise<TokenAccount[]>;

  getTransactionHistory(
    wallet: string,
    options?: { limit?: number; before?: string },
  ): Promise<WalletTransaction[]>;

  getTransaction(signature: string): Promise<WalletTransaction | null>;

  getTransactionStatus(signature: string): Promise<TransactionStatus>;

  getSolBalance(wallet: string): Promise<number>;
}

export interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
  uiAmount: number;
  programId?: string;
}

export interface TokenAccount {
  address: string;
  mint: string;
  owner: string;
  amount: number;
  decimals: number;
  uiAmount: number;
  programId?: string;
}

export type TransactionStatus =
  | 'pending'
  | 'confirmed'
  | 'finalized'
  | 'failed'
  | 'unknown';

export interface WalletTransaction {
  signature: string;
  slot?: number;
  blockTime?: Date;
  status: TransactionStatus;
  feeSol?: number;
  err?: unknown;
  /** Raw / normalized transfer hints when available. */
  transfers?: WalletTransfer[];
}

export interface WalletTransfer {
  mint?: string;
  from?: string;
  to?: string;
  amount?: number;
  decimals?: number;
}
