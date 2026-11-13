/**
 * Token-2022 scaled UI amounts (used by xStocks): the share count users see is
 * raw / 10^decimals * multiplier. Converting shares to raw units without the
 * multiplier oversells, so a "sell all" asks for more raw units than the wallet
 * holds and fails simulation.
 */
export interface ScaledUiConfig {
  multiplier: number;
  newMultiplier?: number;
  /** Unix seconds when newMultiplier takes over. */
  newMultiplierEffectiveTimestamp?: number;
}

export function effectiveMultiplier(
  config: ScaledUiConfig | undefined,
  nowMs = Date.now(),
): number {
  if (!config) return 1;
  const next =
    config.newMultiplier !== undefined &&
    config.newMultiplierEffectiveTimestamp !== undefined &&
    nowMs / 1000 >= config.newMultiplierEffectiveTimestamp
      ? config.newMultiplier
      : config.multiplier;
  return validMultiplier(next) ? next : 1;
}

/** Raw stock units for a displayed share amount, rounded down so it never oversells. */
export function stockSharesToRaw(
  shares: number,
  decimals: number,
  multiplier = 1,
): bigint {
  if (!Number.isFinite(shares) || shares <= 0)
    throw new Error('Share amount must be positive');
  const scale = validMultiplier(multiplier) ? multiplier : 1;
  // Small epsilon absorbs float error such as 0.00528058 * 1e8 = 528057.99999.
  const raw = Math.floor((shares * 10 ** decimals) / scale + 1e-6);
  if (!Number.isSafeInteger(raw) || raw <= 0)
    throw new Error('Share amount is below the token precision');
  return BigInt(raw);
}

/** The share amount to quote so downstream raw conversion lands on `raw` exactly. */
export function rawToQuoteAmount(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

export function parseScaledUiConfig(
  state: unknown,
): ScaledUiConfig | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const value = state as Record<string, unknown>;
  const multiplier = Number(value.multiplier);
  if (!validMultiplier(multiplier)) return undefined;
  const newMultiplier = Number(value.newMultiplier);
  const timestamp = Number(value.newMultiplierEffectiveTimestamp);
  return {
    multiplier,
    ...(validMultiplier(newMultiplier) && Number.isFinite(timestamp)
      ? { newMultiplier, newMultiplierEffectiveTimestamp: timestamp }
      : {}),
  };
}

function validMultiplier(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 1_000_000
  );
}
