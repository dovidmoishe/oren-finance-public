import type { ExecutionFeature } from './execution';
import type { TradeSide } from './quote';

export type VolumeRange = '24h' | '7d' | '30d' | 'all';
export type VolumeInterval = 'hour' | 'day';

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

export interface VolumeResponse extends VolumeTotals {
  range: VolumeRange;
  interval: VolumeInterval;
  timeSeries: VolumePoint[];
  source: 'oren';
  asOf: string;
}

export interface StockVolume extends VolumeTotals {
  assetId: string;
  ticker: string;
}

export interface FeatureVolume extends VolumeTotals {
  feature: ExecutionFeature;
}

export interface VerifiedTradeFill {
  executionId: string;
  transactionSignature: string;
  fillIndex: number;
  walletAddress: string;
  assetId: string;
  ticker: string;
  tokenMint: string;
  side: TradeSide;
  stockAmount: number;
  usdNotional: number;
  executionPriceUsd: number;
  featureSource: ExecutionFeature;
  provider: string;
  slot: number;
  blockTime: Date;
}
