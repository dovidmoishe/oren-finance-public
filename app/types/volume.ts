export type VolumeRange = "24h" | "7d" | "30d" | "all";
export type VolumeInterval = "hour" | "day";

export interface VolumeTotals {
  grossVolumeUsd: number;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  netFlowUsd: number;
  tradeCount: number;
}

export interface VolumePoint extends VolumeTotals {
  timestamp: string;
}

export interface VolumeOverview extends VolumeTotals {
  range: VolumeRange;
  interval: VolumeInterval;
  timeSeries: VolumePoint[];
  source: "oren";
  asOf: string;
}

export interface StockVolume extends VolumeTotals {
  assetId: string;
  ticker: string;
}

export interface FeatureVolume extends VolumeTotals {
  feature: "direct" | "agent" | "basket" | "copy_trade" | "limit_order";
}

export interface StockVolumeResponse extends VolumeTotals {
  assetId: string;
  range: VolumeRange;
  source: "oren";
  asOf: string;
}
