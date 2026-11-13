import type { Equity, TokenizedEquity } from './equity';

/**
 * Aggregated user position for one canonical equity.
 * Available = wallet holdings; locked = Oren vault.
 */
export interface Position {
  assetId: string;
  ticker: string;
  name: string;
  logo?: string;
  category?: Equity['category'];
  currentPrice: number;
  priceChange24h?: number;
  changePercent: number;
  /** Total quantity (available + locked). */
  quantity: number;
  valueUsd: number;
  /** Share of total portfolio value (0–100). */
  allocationPercent: number;
  availableAmount: number;
  lockedAmount: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  /** Optional mint-level breakdown when useful. */
  variants?: PositionVariant[];
}

export interface PositionVariant {
  variant: TokenizedEquity;
  availableAmount: number;
  lockedAmount: number;
  totalAmount: number;
}
