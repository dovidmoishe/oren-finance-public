import type { ExecutionStatus, ExecutionType } from './execution';
import type { SwapRouteLabel } from './route';

export interface TradingCalendarQuery {
  month?: string;
  start?: string;
  end?: string;
  timeZone?: string;
}

export interface TradingCalendarRange {
  start: string;
  end: string;
  month?: string;
}

export interface TradingCalendarContributor {
  assetId: string;
  ticker: string;
  name?: string;
  logo?: string;
  valueChangeUsd: number;
  valueChangePct: number;
  openingValueUsd: number;
  closingValueUsd: number;
}

export interface TradingCalendarEvent {
  id: string;
  type:
    'trade' | 'basket' | 'lock' | 'unlock' | 'agent' | 'wallet' | 'movement';
  title: string;
  detail?: string;
  ticker?: string;
  assetId?: string;
  amountUsd?: number;
  status?: ExecutionStatus | string;
  /** Recorded swap venue. Omitted when the execution has no known route. */
  route?: SwapRouteLabel;
  occurredAt: Date;
}

export interface TradingCalendarDaySummary {
  date: string;
  hasData: boolean;
  openingValueUsd: number;
  closingValueUsd: number;
  pnlUsd: number;
  returnPct: number;
  realizedActivityUsd: number;
  unrealizedMovementUsd: number;
  availableValueUsd: number;
  lockedValueUsd: number;
  cumulativeValueUsd: number;
  eventCount: number;
  significantEvents: TradingCalendarEvent[];
  bestContributor?: TradingCalendarContributor;
  worstContributor?: TradingCalendarContributor;
}

export interface TradingCalendarResponse {
  walletAddress: string;
  timeZone: string;
  range: TradingCalendarRange;
  days: TradingCalendarDaySummary[];
  notes: string[];
}

export interface TradingCalendarTrade {
  id: string;
  type: ExecutionType;
  ticker?: string;
  assetId?: string;
  amount?: number;
  amountUsd?: number;
  status: ExecutionStatus;
  transactionSignature?: string;
  /** Recorded swap venue. Omitted when the execution has no known route. */
  route?: SwapRouteLabel;
  occurredAt: Date;
}

export interface TradingCalendarVaultEvent {
  id: string;
  type: 'lock_created' | 'unlock_due';
  lockAddress: string;
  ticker?: string;
  assetId?: string;
  amount: number;
  occurredAt: Date;
  transactionSignature?: string;
}

export interface TradingCalendarAgentEvent {
  id: string;
  toolName: string;
  summary: string;
  occurredAt: Date;
}

export interface TradingCalendarDayResponse {
  walletAddress: string;
  timeZone: string;
  date: string;
  summary: TradingCalendarDaySummary;
  contributors: TradingCalendarContributor[];
  trades: TradingCalendarTrade[];
  vaultEvents: TradingCalendarVaultEvent[];
  agentEvents: TradingCalendarAgentEvent[];
  walletActivity: TradingCalendarEvent[];
  notes: string[];
}
