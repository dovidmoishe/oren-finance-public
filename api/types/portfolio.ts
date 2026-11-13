import type { Position } from './position';

export interface Portfolio {
  walletAddress: string;
  totalValueUsd: number;
  absoluteChangeUsd: number;
  percentChange: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  /** Supported stablecoin / cash balance. */
  cashValueUsd?: number;
  positions: Position[];
  updatedAt: Date;
}

export interface PortfolioSnapshot {
  id: string;
  walletAddress: string;
  timestamp: Date;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  positionsJson: unknown;
}

export interface PortfolioHistoryPoint {
  timestamp: Date;
  totalValueUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
}

export interface PortfolioHistory {
  walletAddress: string;
  points: PortfolioHistoryPoint[];
}
