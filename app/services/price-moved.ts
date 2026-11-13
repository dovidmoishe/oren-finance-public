import type { PriceMovedDetails } from "@/types";

/** The PRICE_MOVED details from an API error, if that is what it was. */
export function priceMovedFrom(error: unknown): PriceMovedDetails | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  const body = (error as { details?: unknown } | null)?.details as
    | { error?: unknown; priceMoved?: unknown }
    | undefined;
  if (status !== 409 || body?.error !== "PRICE_MOVED") return undefined;
  const details = body.priceMoved as PriceMovedDetails | undefined;
  if (!details || typeof details.quoteId !== "string" || !details.reviewed) return undefined;
  const alternative = details.alternative;
  // Only offer an alternative that is a usable, still-valid quote.
  const usable =
    alternative &&
    typeof alternative.id === "string" &&
    Number.isFinite(alternative.outputAmount) &&
    new Date(alternative.expiresAt).getTime() > Date.now();
  return usable ? details : { ...details, alternative: undefined };
}

/** Output change from the reviewed terms to the alternative, in percent. */
export function priceMovedChangePercent(details: PriceMovedDetails): number | undefined {
  const before = details.reviewed.outputAmount;
  const after = details.alternative?.outputAmount;
  if (!after || !(before > 0)) return undefined;
  return ((after - before) / before) * 100;
}
