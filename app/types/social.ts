import type { BasketAllocation, BasketResponse } from "./execution";
import type { PortfolioActivityItem, PortfolioSnapshot, PortfolioSummary } from "./portfolio";

export type SocialTimeframe = "7D" | "30D" | "90D" | "ALL";
export type SocialRiskLabel = "new" | "steady" | "moderate" | "volatile";

export interface TraderPublicProfile {
  slug: string;
  displayName: string;
  walletPreview: string;
  avatarUrl?: string;
  bio?: string;
}

export interface SocialHoldingSummary {
  assetId: string;
  ticker: string;
  name: string;
  logoUrl?: string;
  allocationPct: number;
  valueUsd: number;
}

export interface LeaderboardRow {
  rank: number;
  slug: string;
  displayName: string;
  walletPreview: string;
  avatarUrl?: string;
  totalValueUsd: number;
  pnlUsd: number;
  pnlPct: number;
  positionCount: number;
  topHolding?: SocialHoldingSummary;
  riskLabel: SocialRiskLabel;
  updatedAt: string;
}

export interface LeaderboardResponse {
  timeframe: SocialTimeframe;
  rows: LeaderboardRow[];
  stats: {
    totalPublicTraders: number;
    averagePnlPct: number;
    topPerformer?: LeaderboardRow;
  };
}

export interface TraderDetailResponse {
  profile: TraderPublicProfile;
  stats: LeaderboardRow;
  portfolio: PortfolioSummary;
  history: {
    walletAddress: string;
    points: PortfolioSnapshot[];
  };
  activity: {
    walletAddress: string;
    items: PortfolioActivityItem[];
  };
  timeframe: SocialTimeframe;
}

export interface CopyPortfolioProposal {
  source: TraderPublicProfile;
  amountUsd: number;
  allocations: BasketAllocation[];
  skippedAssets: Array<{
    assetId?: string;
    ticker?: string;
    reason: string;
  }>;
  riskCopy: string;
  basket: BasketResponse;
}

/** Fields the wallet is asked to sign; the server returns the exact message. */
export interface TraderVisibilityChallengeRequest {
  isPublic: boolean;
  displayName?: string;
  slug?: string;
  avatarUrl?: string;
  bio?: string;
}

export interface TraderVisibilityChallengeResponse {
  message: string;
  expiresAt: string;
}

/** The signed challenge; the server writes only the terms it issued. */
export interface UpdateTraderVisibilityRequest {
  message: string;
  signature: string;
}
