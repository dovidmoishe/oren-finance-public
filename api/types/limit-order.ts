import type { TokenizedEquity } from './equity';
import type { TradeSide } from './quote';
import type { LimitZoneBasis } from './analysis';
import type { MarketSession } from './market-session';

export type LimitOrderStatus =
  | 'open'
  | 'filled'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | 'awaiting_signature';

export interface LimitOrderIntent {
  side: TradeSide;
  assetId?: string;
  ticker: string;
  /** Buy notional in USD (USDC). */
  amountUsd?: number;
  /** Sell quantity in stock tokens. */
  amount?: number;
  /** Limit trigger price in USD per share. */
  limitPriceUsd: number;
  preferredMint?: string;
  /** Unix seconds. Defaults to ~30 days. */
  expiredAt?: number;
  slippageBps?: number;
  wallet?: string;
  /** Optional TA basis when price came from limitZones. */
  basis?: LimitZoneBasis;
}

export interface LimitOrderProposal {
  id: string;
  side: TradeSide;
  assetId: string;
  ticker: string;
  variant: TokenizedEquity;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  /** UI units of input mint. */
  makingAmount: number;
  /** UI units of output mint. */
  takingAmount: number;
  /** Raw base units for Jupiter. */
  makingAmountRaw: string;
  takingAmountRaw: string;
  limitPriceUsd: number;
  amountUsd: number;
  marketPriceUsd?: number;
  wouldFillImmediately: boolean;
  basis?: LimitZoneBasis;
  expiredAt: number;
  slippageBps: number;
  provider: string;
  marketSession?: MarketSession;
  createdAt: Date;
}

export interface PreparedLimitOrder {
  proposalId: string;
  wallet: string;
  /** Base64 unsigned create-order transaction. */
  transaction: string;
  requestId: string;
  /** Jupiter trigger order account pubkey (when returned). */
  orderKey?: string;
  provider: string;
  expiresAt: Date;
  executionId: string;
}

export interface PreparedLimitCancel {
  orderKey: string;
  wallet: string;
  transaction: string;
  requestId: string;
  provider: string;
  expiresAt: Date;
  executionId: string;
}

export interface LimitOrderRecord {
  id: string;
  walletAddress: string;
  orderKey: string;
  side: TradeSide;
  assetId?: string;
  ticker?: string;
  inputMint: string;
  outputMint: string;
  makingAmount: number;
  takingAmount: number;
  limitPriceUsd: number;
  amountUsd?: number;
  status: LimitOrderStatus;
  basis?: LimitZoneBasis;
  openSignature?: string;
  closeSignature?: string;
  expiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
