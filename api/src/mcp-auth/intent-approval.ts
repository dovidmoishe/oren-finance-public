import { USDC_MINT } from '../config/constants';

/** Bind a browser-signed quote to the exact MCP request, including sell quantity. */
export function approvalMatchesMcpIntent(
  intent: {
    side: 'buy' | 'sell';
    assetId: string;
    stockMint: string | null;
    amountUsd: string | null;
    amountShares: string | null;
    maxInRaw: string | null;
    slippageBps: number;
  },
  quote: Record<string, unknown> | undefined,
  expectation: Record<string, unknown> | undefined,
  referenceId: string,
): boolean {
  if (
    !quote ||
    quote.side !== intent.side ||
    quote.assetId !== intent.assetId ||
    quote.id !== referenceId ||
    !Number.isFinite(Number(quote.slippageBps)) ||
    Number(quote.slippageBps) < 1 ||
    Number(quote.slippageBps) > intent.slippageBps
  )
    return false;
  const variant = quote.variant as Record<string, unknown> | undefined;
  if (intent.stockMint && variant?.mint !== intent.stockMint) return false;
  if (intent.maxInRaw && expectation?.maxInRaw !== intent.maxInRaw)
    return false;
  if (intent.side === 'buy')
    return (
      quote.inputMint === USDC_MINT &&
      intent.amountUsd !== null &&
      Number.isFinite(Number(quote.amountUsd)) &&
      Math.abs(Number(quote.amountUsd) - Number(intent.amountUsd)) <= 0.000001
    );
  return (
    quote.outputMint === USDC_MINT &&
    intent.amountShares !== null &&
    Number.isFinite(Number(quote.inputAmount)) &&
    Math.abs(Number(quote.inputAmount) - Number(intent.amountShares)) <=
      0.000000001
  );
}
