import type { ExecutionStatus, ExecutionType } from './execution';
import type { WalletTransaction } from './providers';
import type { SwapRouteLabel } from './route';

/** Indexed Oren execution record (Solana remains authoritative). */
export interface ExecutionRecord {
  id: string;
  walletAddress: string;
  type: ExecutionType;
  assetId?: string;
  ticker?: string;
  tokenMint?: string;
  inputAsset?: string;
  outputAsset?: string;
  amount?: number;
  amountUsd?: number;
  provider?: string;
  /** Friendly venue when `provider` is a recorded Titan or Jupiter route. */
  route?: SwapRouteLabel;
  transactionSignature?: string;
  status: ExecutionStatus;
  createdAt: Date;
}

/**
 * Activity combines Oren execution records with relevant Alchemy wallet activity.
 */
export type ActivityItem =
  | ({ source: 'oren' } & ExecutionRecord)
  | ({ source: 'wallet' } & WalletTransaction);

export interface ActivityFeed {
  walletAddress: string;
  items: ActivityItem[];
}
