// The per-trade ceiling matches the largest USD quote the MCP API accepts.
export const MAX_MCP_TRADE_USD = 100_000;
// Keep cent amounts exact when serialized to the six-decimal signed terms.
export const MAX_GRANT_DAILY_USD = 999_999_999.99;
export const LEGACY_GRANT_SPEND_LIMITS = {
  maxPerTradeUsd: 25,
  maxDailyUsd: 50,
};
export const CUSTOM_GRANT_SPEND_LIMITS = {
  maxPerTradeUsd: MAX_MCP_TRADE_USD,
  maxDailyUsd: MAX_GRANT_DAILY_USD,
};

export function isGrantUsdAmount(value: number) {
  return (
    Number.isFinite(value) &&
    value >= 0.01 &&
    value === Number(value.toFixed(2))
  );
}
