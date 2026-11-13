export interface VaultPosition {
  lockAddress: string;
  owner: string;
  assetId?: string;
  ticker?: string;
  name?: string;
  mint: string;
  /** UI alias for API `amount`. */
  quantity: number;
  valueUsd?: number;
  createdAt: string;
  unlockAt: string;
  transactionSignature?: string;
  daysRemaining?: number;
}

export interface VaultSummary {
  walletAddress: string;
  totalLockedValueUsd: number;
  positions: VaultPosition[];
  /** False until the onchain vault program is deployed. */
  programLive: boolean;
}

/** Matches Nest `LockIntent` for POST /vaults/prepare-lock. */
export interface VaultLockIntent {
  action: "lock";
  wallet: string;
  asset: string;
  assetId?: string;
  mint?: string;
  amount: number;
  unlockAt: string;
}

/** Matches Nest `UnlockIntent` for POST /vaults/prepare-unlock. */
export interface VaultUnlockIntent {
  action: "unlock";
  wallet: string;
  lockAddress: string;
}

export interface PreparedVaultTransaction {
  wallet: string;
  transaction: string;
  lockAddress?: string;
  tokenVaultAddress?: string;
  unlockAt?: string;
  amount?: number;
  mint?: string;
  assetId?: string;
  ticker?: string;
}

export interface ConfirmVaultLockRequest {
  wallet: string;
  signature: string;
  lockAddress: string;
  mint: string;
  assetId?: string;
  ticker?: string;
  amount: number;
  unlockAt: string;
}

export interface ConfirmVaultUnlockRequest {
  wallet: string;
  signature: string;
  lockAddress: string;
}

export interface ConfirmVaultResponse {
  wallet: string;
  lockAddress: string;
  signature: string;
  status: "confirmed";
  portfolioRefreshed: boolean;
}

/** @deprecated Prefer VaultLockIntent */
export type VaultIntent = VaultLockIntent;
