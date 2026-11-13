/** Friendly venue shown for a recorded swap provider. */
export type SwapRouteLabel = "Titan" | "Jupiter";

/**
 * Map a stored execution or quote provider to Titan or Jupiter.
 * Missing and unrecognized providers stay unlabeled so nothing is guessed.
 */
export function routeVenueLabel(provider?: string | null): SwapRouteLabel | undefined {
  const value = provider?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith("titan")) return "Titan";
  if (value.startsWith("jupiter")) return "Jupiter";
  return undefined;
}

/** Ticket line for a live quote. Unknown providers stay neutral instead of raw ids. */
export function formatQuotedRoute(provider: string | null | undefined, symbol: string) {
  return `${routeVenueLabel(provider) ?? "Selected route"} · ${symbol}`;
}
