"use client";

import { create } from "zustand";
import { getMarketOpportunities, getStocks, getTrendingStocks, searchStocks } from "@/services";
import type { StockSummary } from "@/types";

interface MarketState {
  stocks: StockSummary[];
  trending: StockSummary[];
  opportunities: StockSummary[];
  searchResults: StockSummary[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isSearching: boolean;
  hasMore: boolean;
  nextPage: number;
  error?: string;
  loadMoreError?: string;
  loadMarkets: () => Promise<void>;
  loadNextStocks: () => Promise<void>;
  search: (query: string) => Promise<void>;
}

const STOCKS_PAGE_SIZE = 20;
let searchRequestId = 0;

function mergeStocks(existing: StockSummary[], incoming: StockSummary[]) {
  if (!existing.length) {
    return incoming;
  }

  const byId = new Map(existing.map((stock) => [stock.assetId, stock]));
  for (const stock of incoming) {
    byId.set(stock.assetId, { ...byId.get(stock.assetId), ...stock });
  }

  return [...byId.values()];
}

export const useMarketStore = create<MarketState>((set, get) => ({
  stocks: [],
  trending: [],
  opportunities: [],
  searchResults: [],
  isLoading: false,
  isLoadingMore: false,
  isSearching: false,
  hasMore: true,
  nextPage: 1,
  async loadMarkets() {
    if (get().isLoading) return;

    const { hasMore: previousHasMore, nextPage, stocks } = get();
    set({ isLoading: true, error: undefined });
    try {
      const [stockPage, trendingResult, opportunitiesResult] = await Promise.all([
        getStocks(1, STOCKS_PAGE_SIZE),
        getTrendingStocks().catch(() => []),
        getMarketOpportunities().catch(() => []),
      ]);
      set({
        opportunities: opportunitiesResult,
        stocks: mergeStocks(stocks, stockPage.items),
        trending: trendingResult,
        hasMore: stocks.length > stockPage.items.length ? previousHasMore : stockPage.pagination.hasMore,
        nextPage: Math.max(nextPage, 2),
        isLoading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unable to load markets", isLoading: false });
    }
  },
  async loadNextStocks() {
    const { hasMore, isLoading, isLoadingMore, nextPage, stocks } = get();
    if (!hasMore || isLoading || isLoadingMore) return;

    set({ isLoadingMore: true, loadMoreError: undefined });
    try {
      const stockPage = await getStocks(nextPage, STOCKS_PAGE_SIZE);
      set({
        stocks: mergeStocks(stocks, stockPage.items),
        hasMore: stockPage.pagination.hasMore,
        nextPage: nextPage + 1,
        isLoadingMore: false,
      });
    } catch (error) {
      set({
        loadMoreError: error instanceof Error ? error.message : "Unable to load more stocks",
        isLoadingMore: false,
      });
    }
  },
  async search(query) {
    const requestId = ++searchRequestId;
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ searchResults: [], isSearching: true, error: undefined });
    try {
      const searchResults = await searchStocks(query);
      if (requestId !== searchRequestId) return;
      set({ searchResults });
    } catch (error) {
      if (requestId !== searchRequestId) return;
      set({
        error: error instanceof Error ? error.message : "Unable to search stocks",
      });
    } finally {
      if (requestId === searchRequestId) set({ isSearching: false });
    }
  },
}));
