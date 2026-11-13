import { apiRequest } from "./api-client";
import type { SavedThesis, StockResearch } from "@/types";

function options(walletAddress: string, token: string) {
  return {
    query: { walletAddress },
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store" as const,
  };
}

export function getStockResearch(
  assetId: string,
  walletAddress: string,
  token: string,
): Promise<StockResearch> {
  return apiRequest<StockResearch>(
    `/research/stocks/${encodeURIComponent(assetId)}`,
    options(walletAddress, token),
  );
}

export function saveStockThesis(
  assetId: string,
  walletAddress: string,
  token: string,
  note: string,
  saved: boolean,
): Promise<SavedThesis> {
  return apiRequest<SavedThesis>(
    `/research/saved/${encodeURIComponent(assetId)}`,
    {
      ...options(walletAddress, token),
      method: saved ? "PATCH" : "PUT",
      body: { note },
    },
  );
}

export function removeStockThesis(
  assetId: string,
  walletAddress: string,
  token: string,
): Promise<void> {
  return apiRequest<void>(`/research/saved/${encodeURIComponent(assetId)}`, {
    ...options(walletAddress, token),
    method: "DELETE",
  });
}

export function recordResearchSourceOpen(
  assetId: string,
  walletAddress: string,
  token: string,
): Promise<void> {
  return apiRequest<void>(
    `/research/source-open/${encodeURIComponent(assetId)}`,
    { ...options(walletAddress, token), method: "POST" },
  );
}
