import type { ActivityFeed } from './activity';
import type { Basket, BasketAllocation } from './execution';
import type { Portfolio, PortfolioHistory } from './portfolio';

export type SocialTimeframe = '7D' | '30D' | '90D' | 'ALL';

export type SocialRiskLabel = 'new' | 'steady' | 'moderate' | 'volatile';

export interface TraderProfile {
  id: string;
  walletAddress: string;
  slug: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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
  updatedAt: Date;
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
  portfolio: Portfolio;
  history: PortfolioHistory;
  activity: ActivityFeed;
  timeframe: SocialTimeframe;
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
  expiresAt: Date;
}

/** The signed challenge; the server writes only the terms it issued. */
export interface UpdateTraderVisibilityRequest {
  message: string;
  signature: string;
}

export interface UpdateTraderVisibilityResponse {
  profile: TraderProfile;
}

export interface CopyPortfolioPrepareRequest {
  sourceSlug: string;
  wallet: string;
  amountUsd: number;
}

export interface CopyPortfolioProposal {
  source: TraderPublicProfile;
  amountUsd: number;
  allocations: BasketAllocation[];
  skippedAssets: {
    assetId?: string;
    ticker?: string;
    reason: string;
  }[];
  riskCopy: string;
  basket: Basket;
}
