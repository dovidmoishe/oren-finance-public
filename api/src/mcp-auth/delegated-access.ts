/**
 * Who may enroll in and use delegated trading. Public access lifts only the
 * named-user allowlist: every grant still needs the owner's wallet-signed
 * terms, and the per-trade, daily, slippage and expiry limits still apply.
 */
export interface DelegatedAccess {
  publicAccess?: boolean;
  allowedUsers: ReadonlySet<string>;
}

export function delegatedUserAllowed(
  access: DelegatedAccess,
  userId: string | undefined,
): boolean {
  if (!userId?.trim()) return false;
  return access.publicAccess === true || access.allowedUsers.has(userId);
}
