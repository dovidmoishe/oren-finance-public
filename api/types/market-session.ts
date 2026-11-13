/** US cash-session state for a tokenized stock quote or order. */
export type UsMarketSessionState =
  | 'regular'
  | 'pre_market'
  | 'after_hours'
  | 'overnight'
  | 'closed'
  | 'early_close';

/**
 * Server clock for the NYSE cash session. The UI renders `summary` when
 * `regular` is false. `thinBook` is true only outside the regular session
 * when the fill is expensive or the pool is small.
 */
export interface MarketSession {
  state: UsMarketSessionState;
  regular: boolean;
  summary: string;
  observedAt: string;
  thinBook?: boolean;
}
