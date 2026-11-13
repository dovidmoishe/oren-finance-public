import { apiRequest } from "./api-client";
import type {
  FeatureVolume,
  StockVolume,
  StockVolumeResponse,
  VolumeInterval,
  VolumeOverview,
  VolumeRange,
} from "@/types";

export function getVolumeOverview(range: VolumeRange = "24h", interval: VolumeInterval = "hour") {
  return apiRequest<VolumeOverview>("/analytics/volume", { query: { range, interval } });
}

export function getStockVolumes(range: VolumeRange = "24h") {
  return apiRequest<{ range: VolumeRange; items: StockVolume[]; source: "oren"; asOf: string }>(
    "/analytics/volume/stocks",
    { query: { range } },
  );
}

export function getFeatureVolumes(range: VolumeRange = "24h") {
  return apiRequest<{ range: VolumeRange; items: FeatureVolume[]; source: "oren"; asOf: string }>(
    "/analytics/volume/features",
    { query: { range } },
  );
}

export function getStockVolume(assetId: string, range: VolumeRange = "24h") {
  return apiRequest<StockVolumeResponse>(`/stocks/${encodeURIComponent(assetId)}/volume`, {
    query: { range },
  });
}

export function getExecutionTrackingStatus(executionId: string) {
  return apiRequest<{ executionId: string; signature?: string; status: string; submittedAt?: string }>(
    `/execution/${encodeURIComponent(executionId)}/status`,
  );
}
