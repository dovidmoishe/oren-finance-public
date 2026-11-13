/** Raw Jupiter Swap API v1 quote response (subset we care about). */
export interface JupiterQuoteRaw {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps: number;
  /** Ratio from 0 to 1. `0.01` is 1% price impact. */
  priceImpactPct?: string | number;
  routePlan?: unknown[];
  contextSlot?: number;
  // Full payload is retained as routePayload for /swap
  [key: string]: unknown;
}

export interface JupiterSwapRaw {
  swapTransaction: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
}
