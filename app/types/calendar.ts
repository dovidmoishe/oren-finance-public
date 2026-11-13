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
  type: "trade" | "basket" | "lock" | "unlock" | "agent" | "wallet" | "movement";
  title: string;
  detail?: string;
  ticker?: string;
  assetId?: string;
  amountUsd?: number;
  status?: string;
  /** Recorded swap venue. Absent when that trade has no stored route. */
  route?: "Titan" | "Jupiter";
  occurredAt: string;
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
  range: {
    start: string;
    end: string;
    month?: string;
  };
  days: TradingCalendarDaySummary[];
  notes: string[];
}

export interface TradingCalendarTrade {
  id: string;
  type: "stock_purchase" | "stock_sale" | "basket_purchase" | "lock" | "unlock";
  ticker?: string;
  assetId?: string;
  amount?: number;
  amountUsd?: number;
  status: string;
  transactionSignature?: string;
  route?: "Titan" | "Jupiter";
  occurredAt: string;
}

export interface TradingCalendarVaultEvent {
  id: string;
  type: "lock_created" | "unlock_due";
  lockAddress: string;
  ticker?: string;
  assetId?: string;
  amount: number;
  occurredAt: string;
  transactionSignature?: string;
}

export interface TradingCalendarAgentEvent {
  id: string;
  toolName: string;
  summary: string;
  occurredAt: string;
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
