"use client";

import { create } from "zustand";
import { sessionSetter } from "@/services/wallet-session";
import { getLeaderboard, getTraderProfile, prepareCopyPortfolio } from "@/services";
import type {
  CopyPortfolioProposal,
  LeaderboardResponse,
  SocialTimeframe,
  TraderDetailResponse,
} from "@/types";

interface SocialState {
  timeframe: SocialTimeframe;
  leaderboard?: LeaderboardResponse;
  selectedTrader?: TraderDetailResponse;
  copyProposal?: CopyPortfolioProposal;
  isLoading: boolean;
  isCopying: boolean;
  error?: string;
  copyError?: string;
  loadLeaderboard: (timeframe?: SocialTimeframe) => Promise<void>;
  loadTrader: (slug: string, timeframe?: SocialTimeframe) => Promise<void>;
  prepareCopy: (input: { sourceSlug: string; wallet: string; amountUsd: number }) => Promise<CopyPortfolioProposal | undefined>;
  clearCopy: () => void;
}

export const useSocialStore = create<SocialState>((set, get) => ({
  timeframe: "30D",
  isLoading: false,
  isCopying: false,
  async loadLeaderboard(timeframe = get().timeframe) {
    set({ timeframe, isLoading: true, error: undefined });
    try {
      const leaderboard = await getLeaderboard(timeframe);
      set({ leaderboard, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load leaderboard", isLoading: false });
    }
  },
  async loadTrader(slug, timeframe = get().timeframe) {
    set({ timeframe, selectedTrader: undefined, isLoading: true, error: undefined });
    try {
      const selectedTrader = await getTraderProfile(slug, timeframe);
      set({ selectedTrader, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load trader profile", isLoading: false });
    }
  },
  async prepareCopy(input) {
    const update = sessionSetter(set);
    update({ isCopying: true, copyError: undefined, copyProposal: undefined });
    try {
      const copyProposal = await prepareCopyPortfolio(input);
      update({ copyProposal, isCopying: false });
      return copyProposal;
    } catch (error) {
      update({ copyError: error instanceof Error ? error.message : "Unable to prepare copy proposal", isCopying: false });
      return undefined;
    }
  },
  clearCopy() {
    set({ copyProposal: undefined, copyError: undefined, isCopying: false });
  },
}));
