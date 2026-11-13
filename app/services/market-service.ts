import { apiRequest } from "./api-client";
import type { ChartRange, MarketCandle, NewsItem, StockAnalysis, StockDetail, StockSummary, StocksPage } from "@/types";

interface ApiStockSummary {
  id?: string;
  assetId?: string;
  ticker: string;
  name: string;
  logo?: string;
  logoUrl?: string;
  category?: "equity" | "etf" | "index";
  price?: number;
  priceUsd?: number;
  priceChange24h?: number;
  change24hPct?: number;
  volume24h?: number;
  volume24hUsd?: number;
  liquidity?: number;
  liquidityUsd?: number;
  opportunityScore?: number;
}

interface ApiStocksPage {
  items: ApiStockSummary[];
  pagination: StocksPage["pagination"];
}

interface ApiStockDetail extends ApiStockSummary {
  sector?: string;
  variants: StockDetail["variants"];
}

interface ApiStockAnalysis {
  assetId: string;
  ticker: string;
  name?: string;
  opportunityScore: number;
  summary?: string;
  technicalBrief?: StockAnalysis["technicalBrief"];
  signals: StockAnalysis["signals"];
  highlights: string[];
  riskLabel?: StockAnalysis["riskLabel"];
  analyzedAt: string;
}

interface ApiNewsFeed {
  items: Array<Omit<NewsItem, "id"> & { id?: string }>;
}

export function getStocks(page = 1, limit = 20) {
  return apiRequest<ApiStocksPage>("/stocks", {
    query: { page, limit },
  }).then((response): StocksPage => ({
    items: response.items.map(mapStockSummary),
    pagination: response.pagination,
  }));
}

export function searchStocks(query: string) {
  return apiRequest<ApiStockSummary[]>("/stocks/search", {
    query: { q: query },
  }).then((stocks) => stocks.map(mapStockSummary));
}

export function getStock(assetId: string) {
  return apiRequest<ApiStockDetail>(`/stocks/${assetId}`).then(mapStockDetail);
}

export function getStockChart(assetId: string, range: ChartRange) {
  return apiRequest<{ candles: MarketCandle[] }>(`/stocks/${assetId}/chart`, {
    query: { range },
  }).then((series) => series.candles);
}

export function getStockAnalysis(assetId: string) {
  return apiRequest<ApiStockAnalysis>(`/stocks/${assetId}/analysis`).then(
    (analysis): StockAnalysis => analysis,
  );
}

export function getStockNews(assetId: string) {
  return apiRequest<ApiNewsFeed>(`/stocks/${assetId}/news`).then((feed) =>
    feed.items.map((item, index) => ({
      ...item,
      id: item.id ?? `${assetId}-${item.publishedAt}-${index}`,
    })),
  );
}

export function getTrendingStocks() {
  return apiRequest<ApiStockSummary[]>("/markets/trending").then((stocks) => stocks.map(mapStockSummary));
}

export function getMarketOpportunities() {
  return apiRequest<ApiStockSummary[]>("/markets/opportunities").then((stocks) => stocks.map(mapStockSummary));
}

export function mapStockSummary(stock: ApiStockSummary): StockSummary {
  return {
    assetId: stock.assetId ?? stock.id ?? stock.ticker,
    ticker: stock.ticker,
    name: stock.name,
    logoUrl: stock.logoUrl ?? stock.logo,
    category: stock.category,
    priceUsd: stock.priceUsd ?? stock.price,
    change24hPct: stock.change24hPct ?? stock.priceChange24h,
    volume24hUsd: stock.volume24hUsd ?? stock.volume24h,
    liquidityUsd: stock.liquidityUsd ?? stock.liquidity,
    opportunityScore: stock.opportunityScore,
  };
}

export function mapStockDetail(stock: ApiStockDetail): StockDetail {
  return {
    ...mapStockSummary(stock),
    sector: stock.sector,
    variants: stock.variants ?? [],
  };
}
