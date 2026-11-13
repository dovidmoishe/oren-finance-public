export type UsMarketSessionState =
  | "regular"
  | "pre_market"
  | "after_hours"
  | "overnight"
  | "closed"
  | "early_close";

export interface MarketSession {
  state: UsMarketSessionState;
  regular: boolean;
  summary: string;
  observedAt: string;
  thinBook?: boolean;
}
