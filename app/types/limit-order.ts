import type { QuoteVariant, TradeSide } from "./execution";
import type { MarketSession } from "./market-session";
import type { LimitZoneBasis } from "./stock";

export type LimitOrderStatus =
  | "open"
  | "filled"
  | "cancelled"
  | "expired"
  | "failed"
  | "awaiting_signature";

export interface LimitOrderIntent {
  side: TradeSide;
  assetId?: string;
  ticker: string;
  amountUsd?: number;
  amount?: number;
  limitPriceUsd: number;
  preferredMint?: string;
  expiredAt?: number;
  slippageBps?: number;
  wallet?: string;
  basis?: LimitZoneBasis;
}

export interface LimitOrderProposal {
  id: string;
  side: TradeSide;
  assetId: string;
  ticker: string;
  variant: QuoteVariant;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  makingAmount: number;
  takingAmount: number;
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
  createdAt: string;
}

export interface PreparedLimitOrder {
  proposalId: string;
  wallet: string;
  transaction: string;
  requestId: string;
  orderKey?: string;
  provider: string;
  expiresAt: string;
  executionId: string;
}

export interface PreparedLimitCancel {
  orderKey: string;
  wallet: string;
  transaction: string;
  requestId: string;
  provider: string;
  expiresAt: string;
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
  expiredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LimitOrderConfirmResponse {
  proposalId: string;
  wallet: string;
  signature: string;
  orderKey: string;
  status: "confirmed";
  portfolioRefreshed: boolean;
}

export interface LimitOrderCancelConfirmResponse {
  orderKey: string;
  wallet: string;
  signature: string;
  status: "cancelled";
}
