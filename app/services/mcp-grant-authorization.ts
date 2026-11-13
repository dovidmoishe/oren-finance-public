export type GrantReview = {
  delegationId: string; wallet: string; signerId: string; policyId: string;
  perTradeUsd: string; dailyUsd: string; maxSlippageBps: number;
  allowSell: boolean; expiresAt: string | null;
};
export type GrantSettings = {
  perTradeUsd: number; dailyUsd: number; maxSlippageBps: number;
  allowSell: boolean; durationHours: number | null;
};
export type TrustedTradeSigner = { signerId: string; policyId: string };

export function validateTrustedTradeSigner(review: Pick<GrantReview, "signerId" | "policyId">,
  trusted: TrustedTradeSigner) {
  if (!trusted.signerId || !trusted.policyId || review.signerId !== trusted.signerId || review.policyId !== trusted.policyId)
    throw new Error("Chat trading enrollment is unavailable for this signer. Refresh or contact support.");
}

/** Check the signed content against what this browser displayed, before Privy. */
export function validateGrantPermission(message: string, wallet: string, appId: string,
  action: "prepare" | "activate" | "revoke", review: GrantSettings | GrantReview | { delegationId: string },
  trusted: TrustedTradeSigner) {
  const prefix = "Oren chat trading permission\n";
  if (!message.startsWith(prefix) || message.length > 4096) throw new Error("Invalid permission request.");
  const value = JSON.parse(message.slice(prefix.length));
  const now = Date.now();
  if (value.version !== 1 || value.appId !== appId || value.action !== action || value.wallet !== wallet ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.validUntil) ||
      value.issuedAt > now + 5000 || value.validUntil <= now ||
      value.validUntil <= value.issuedAt || value.validUntil - value.issuedAt > 300000)
    throw new Error("Your permission request changed or expired. Review it again.");
  if ("delegationId" in review && value.delegationId !== review.delegationId)
    throw new Error("This permission is for a different grant.");
  if (action === "revoke") {
    if (value.terms !== null || value.signerId !== null || value.policyId !== null)
      throw new Error("Revocation must not grant new trading permission.");
    return;
  }
  validateTrustedTradeSigner(value, trusted);
  if (!("perTradeUsd" in review) || !value.terms ||
      value.terms.perTradeUsd !== Number(review.perTradeUsd).toFixed(6) ||
      value.terms.dailyUsd !== Number(review.dailyUsd).toFixed(6) ||
      value.terms.maxSlippageBps !== review.maxSlippageBps || value.terms.allowSell !== review.allowSell)
    throw new Error("Trading limits differ from the terms you reviewed.");
  const expiry = value.terms.expiresAt === null ? null : Date.parse(value.terms.expiresAt);
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= now)) throw new Error("Trading permission expired.");
  if ("durationHours" in review) {
    if (review.durationHours === null ? expiry !== null : expiry === null || expiry > value.issuedAt + review.durationHours * 3600000)
      throw new Error("Trading duration differs from your selection.");
  } else if (!("signerId" in review) || value.signerId !== review.signerId ||
      value.policyId !== review.policyId || value.terms.expiresAt !== review.expiresAt) {
    throw new Error("The wallet signer or permission changed. Review it again.");
  }
}
