import type { GrantSettings } from "./mcp-grant-authorization";

export type GrantDraft = {
  perTradeUsd: string;
  dailyUsd: string;
  slippagePercent: string;
  durationHours: string;
};

export type GrantSpendLimits = { maxPerTradeUsd: number; maxDailyUsd: number };

export function grantDurationOptions(maxDurationHours = 24): number[] {
  return [1, 6, 12, 24, 48, 72].filter(hours => hours <= maxDurationHours);
}

export function parseGrantSettings(draft: GrantDraft, sellAvailable: boolean, maxDurationHours = 24, untilRevoked = false, spendLimits?: GrantSpendLimits): GrantSettings {
  const dollars = (value: string, max: number) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) < 0.01 || Number(value) > max)
      throw new Error(`Enter an amount between $0.01 and $${max}.`);
    return Number(value);
  };
  const perTradeUsd = dollars(draft.perTradeUsd, spendLimits?.maxPerTradeUsd ?? 25);
  const dailyUsd = dollars(draft.dailyUsd, spendLimits?.maxDailyUsd ?? 50);
  if (dailyUsd < perTradeUsd) throw new Error("Your 24-hour limit must cover at least one trade.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(draft.slippagePercent) ||
      Number(draft.slippagePercent) < 0.01 || Number(draft.slippagePercent) > 0.5)
    throw new Error("Choose a price tolerance between 0.01% and 0.5%.");
  const durationHours = untilRevoked ? null : Number(draft.durationHours);
  if (durationHours !== null && !grantDurationOptions(maxDurationHours).includes(durationHours))
    throw new Error("Choose an available permission duration.");
  return { perTradeUsd, dailyUsd, maxSlippageBps: Math.round(Number(draft.slippagePercent) * 100), durationHours, allowSell: sellAvailable };
}
