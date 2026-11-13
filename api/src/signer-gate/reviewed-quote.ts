/** Tighten fresh slippage to preserve the owner's original absolute output floor. */
export function reviewedQuoteFloor(
  outRaw: string,
  reviewedMinRaw: string,
  maxBps: number,
) {
  if (
    !/^\d+$/.test(outRaw) ||
    !/^\d+$/.test(reviewedMinRaw) ||
    BigInt(outRaw) <= 0n ||
    BigInt(reviewedMinRaw) <= 0n ||
    !Number.isInteger(maxBps) ||
    maxBps < 0 ||
    maxBps > 50
  )
    throw new Error('Invalid reviewed quote bounds');
  const out = BigInt(outRaw),
    minimum = BigInt(reviewedMinRaw);
  if (out < minimum)
    throw new Error('Fresh Jupiter quote moved outside the reviewed terms');
  const remaining = ((out - minimum) * 10000n) / out;
  const slippageBps = Number(
    remaining < BigInt(maxBps) ? remaining : BigInt(maxBps),
  );
  return {
    slippageBps,
    otherAmountThreshold: (
      (out * BigInt(10000 - slippageBps)) /
      10000n
    ).toString(),
  };
}
