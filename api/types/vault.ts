import type { TokenizedEquity } from './equity';

/** Indexed vault / timelock position. Onchain state is authoritative. */
export interface VaultPosition {
  lockAddress: string;
  owner: string;
  mint: string;
  assetId?: string;
  ticker?: string;
  amount: number;
  createdAt: Date;
  unlockAt: Date;
  transactionSignature: string;
  indexedAt: Date;
  variant?: TokenizedEquity;
  name?: string;
  valueUsd?: number;
  daysRemaining?: number;
}

export interface VaultSummary {
  walletAddress: string;
  totalLockedValueUsd: number;
  positions: VaultPosition[];
  /** False until the onchain vault program is deployed. Clients must not offer signing. */
  programLive: boolean;
}

export interface LockIntent {
  action: 'lock';
  wallet: string;
  /** Canonical ticker, e.g. NVDA. */
  asset: string;
  assetId?: string;
  mint?: string;
  amount: number;
  unlockAt: Date;
}

export interface UnlockIntent {
  action: 'unlock';
  wallet: string;
  lockAddress: string;
}

export interface PreparedVaultTransaction {
  wallet: string;
  transaction: string;
  lockAddress?: string;
  tokenVaultAddress?: string;
  unlockAt?: Date;
  amount?: number;
  mint?: string;
  assetId?: string;
  ticker?: string;
}

export interface ConfirmLockRequest {
  wallet: string;
  signature: string;
  lockAddress: string;
  mint: string;
  assetId?: string;
  ticker?: string;
  amount: number;
  unlockAt: Date;
}

export interface ConfirmUnlockRequest {
  wallet: string;
  signature: string;
  lockAddress: string;
}

export interface ConfirmVaultResponse {
  wallet: string;
  lockAddress: string;
  signature: string;
  status: 'confirmed';
  portfolioRefreshed: boolean;
}
