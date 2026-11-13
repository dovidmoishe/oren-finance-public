"use client";

import { create } from "zustand";
import { getStock, getStockAnalysis, getStockChart, getStockNews } from "@/services";
import type { ChartRange, MarketCandle, NewsItem, StockAnalysis, StockDetail } from "@/types";

interface StockState {
  selected?: StockDetail;
  chart: MarketCandle[];
  analysis?: StockAnalysis;
  news: NewsItem[];
  isLoading: boolean;
  isChartLoading: boolean;
  error?: string;
  chartError?: string;
  loadStock: (assetId: string, range?: ChartRange) => Promise<void>;
  loadChart: (assetId: string, range: ChartRange) => Promise<void>;
  reset: () => void;
}

let stockRequestId = 0;
let chartRequestId = 0;

export const useStockStore = create<StockState>((set) => ({
  chart: [],
  news: [],
  isLoading: false,
  isChartLoading: false,
  async loadStock(assetId, range = "1M") {
    const requestId = ++stockRequestId;
    set({
      selected: undefined,
      chart: [],
      analysis: undefined,
      news: [],
      isLoading: true,
      error: undefined,
      chartError: undefined,
    });
    const [selectedResult, chartResult, analysisResult, newsResult] = await Promise.allSettled([
        getStock(assetId),
        getStockChart(assetId, range),
        getStockAnalysis(assetId),
        getStockNews(assetId),
      ]);

    if (requestId !== stockRequestId) return;
    if (selectedResult.status === "rejected") {
      set({
        error:
          selectedResult.reason instanceof Error
            ? selectedResult.reason.message
            : "Unable to load stock",
        isLoading: false,
      });
      return;
    }

    set({
      selected: selectedResult.value,
      chart: chartResult.status === "fulfilled" ? chartResult.value : [],
      chartError:
        chartResult.status === "rejected"
          ? chartResult.reason instanceof Error
            ? chartResult.reason.message
            : "Unable to load chart"
          : undefined,
      analysis: analysisResult.status === "fulfilled" ? analysisResult.value : undefined,
      news: newsResult.status === "fulfilled" ? newsResult.value : [],
      isLoading: false,
    });
  },
  async loadChart(assetId, range) {
    const requestId = ++chartRequestId;
    set({ isChartLoading: true, chartError: undefined });
    try {
      const chart = await getStockChart(assetId, range);
      if (requestId !== chartRequestId) return;
      set({ chart, isChartLoading: false, chartError: undefined });
    } catch (error) {
      if (requestId !== chartRequestId) return;
      set({
        chart: [],
        isChartLoading: false,
        chartError: error instanceof Error ? error.message : "Unable to load chart",
      });
    }
  },
  reset() {
    stockRequestId += 1;
    chartRequestId += 1;
    set({
      selected: undefined,
      chart: [],
      analysis: undefined,
      news: [],
      isLoading: false,
      isChartLoading: false,
      error: undefined,
      chartError: undefined,
    });
  },
}));
