import { apiRequest } from "./api-client";
import { mapActivityItem, mapPortfolio } from "./portfolio-service";
import type {
  CopyPortfolioProposal,
  LeaderboardResponse,
  SocialTimeframe,
  TraderDetailResponse,
  TraderVisibilityChallengeRequest,
  TraderVisibilityChallengeResponse,
  UpdateTraderVisibilityRequest,
} from "@/types";

export function getLeaderboard(timeframe: SocialTimeframe = "30D", limit = 50) {
  return apiRequest<LeaderboardResponse>("/social/leaderboard", {
    query: { timeframe, limit },
  });
}

export function getTraderProfile(slug: string, timeframe: SocialTimeframe = "30D") {
  return apiRequest<ApiTraderDetailResponse>(`/social/traders/${slug}`, {
    query: { timeframe },
  }).then(mapTraderDetail);
}

export function prepareCopyPortfolio(input: {
  sourceSlug: string;
  wallet: string;
  amountUsd: number;
}) {
  return apiRequest<CopyPortfolioProposal>("/social/copy-portfolio/prepare", {
    method: "POST",
    body: input,
  });
}

/** Asks the server for the single-use message the wallet must sign. */
export function requestVisibilityChallenge(wallet: string, input: TraderVisibilityChallengeRequest) {
  return apiRequest<TraderVisibilityChallengeResponse>(`/social/profiles/${wallet}/visibility/challenge`, {
    method: "POST",
    body: input,
  });
}

export function updateTraderVisibility(wallet: string, input: UpdateTraderVisibilityRequest) {
  return apiRequest(`/social/profiles/${wallet}/visibility`, {
    method: "POST",
    body: input,
  });
}

export function normalizeTraderSlug(value: string, fallbackWallet?: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  if (normalized.length >= 3) return normalized;
  return fallbackWallet ? `trader-${fallbackWallet.slice(0, 8).toLowerCase()}` : normalized;
}

interface ApiTraderDetailResponse extends Omit<TraderDetailResponse, "portfolio" | "activity"> {
  portfolio: Parameters<typeof mapPortfolio>[0];
  activity: {
    walletAddress: string;
    items: Parameters<typeof mapActivityItem>[0][];
  };
}

function mapTraderDetail(detail: ApiTraderDetailResponse): TraderDetailResponse {
  const activityItems = Array.isArray(detail.activity?.items) ? detail.activity.items : [];
  const historyPoints = Array.isArray(detail.history?.points) ? detail.history.points : [];

  return {
    ...detail,
    portfolio: mapPortfolio(detail.portfolio),
    history: {
      walletAddress: detail.history?.walletAddress ?? detail.portfolio.walletAddress,
      points: historyPoints,
    },
    activity: {
      walletAddress: detail.activity?.walletAddress ?? detail.portfolio.walletAddress,
      items: activityItems.map(mapActivityItem),
    },
  };
}
