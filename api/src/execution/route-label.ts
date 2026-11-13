import type { SwapRouteLabel } from '../../types/route';

export type { SwapRouteLabel };

/**
 * Map a stored execution provider to Titan or Jupiter.
 * Missing and unrecognized providers stay unlabeled so older rows are never guessed.
 */
export function routeVenueLabel(
  provider?: string | null,
): SwapRouteLabel | undefined {
  const value = provider?.trim().toLowerCase();
  if (!value) return undefined;
  if (value.startsWith('titan')) return 'Titan';
  if (value.startsWith('jupiter')) return 'Jupiter';
  return undefined;
}
