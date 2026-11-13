export type PortfolioRange = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

export interface PortfolioPosition {
  assetId: string;
  ticker: string;
  name: string;
  logoUrl?: string;
  quantity: number;
  availableQuantity: number;
  lockedQuantity: number;
  priceUsd: number;
  valueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  allocationPct: number;
  change24hPct?: number;
}

export interface PortfolioSummary {
  wallet: string;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  cashValueUsd: number;
  changeUsd?: number;
  changePct?: number;
  positions: PortfolioPosition[];
  updatedAt: string;
}

export interface PortfolioSnapshot {
  timestamp: string;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
}

export interface PortfolioActivityItem {
  id: string;
  type: "trade" | "basket" | "lock" | "unlock" | "transfer" | "unknown";
  ticker?: string;
  assetId?: string;
  quantity?: number;
  valueUsd?: number;
  status?: string;
  signature?: string;
  /** Recorded Titan or Jupiter route. Absent when the trade has no stored venue. */
  route?: "Titan" | "Jupiter";
  occurredAt: string;
}
