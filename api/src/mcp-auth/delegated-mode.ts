import { grantExpired } from './grant-duration';

export type BrowserReason =
  | 'inactive_delegation'
  | 'delegation_expired'
  | 'delegation_policy_changed'
  | 'execute_consent_outdated'
  | 'unsupported_venue'
  | 'slippage_above_grant'
  | 'sells_not_allowed'
  | 'unpriced_sell';

const BROWSER_MESSAGES: Record<BrowserReason, string> = {
  inactive_delegation:
    'No active in-chat signing grant is available for this connection. The user can approve this trade in the browser.',
  delegation_expired:
    'The wallet’s in-chat signing grant expired. Renew it in Oren, reconnect this client with trade execution enabled, and prepare a fresh trade.',
  delegation_policy_changed:
    'Oren’s signing policy changed. Renew the wallet grant in Oren, reconnect this client with trade execution enabled, and prepare a fresh trade.',
  execute_consent_outdated:
    'This connection predates the current signing grant. Reconnect this client with trade execution enabled, then prepare a fresh trade.',
  unsupported_venue:
    'This quote uses a route that cannot be signed in chat. The signing grant is still active. This is not a missing signing permission. The review link is only for this route.',
  slippage_above_grant:
    'The requested slippage is above the active signing grant. The grant is still active. Lower the slippage or raise the grant, then prepare again.',
  sells_not_allowed:
    'The active signing grant does not allow sells. This is not a missing grant. Buys can still be signed in chat, or the user can approve this sell in the browser.',
  unpriced_sell:
    'This sell could not be priced for in-chat signing. The signing grant is still active. The user can approve it in the browser.',
};

interface GrantCheck {
  executeEnabled: boolean;
  signerPolicyId?: string;
  slippageBps: number;
  side: 'buy' | 'sell';
  delegation?: {
    activatedAt: Date | null;
    expiresAt: Date | null;
    status: string;
    policyId: string;
    maxSlippageBps: number;
    allowSell: boolean;
  } | null;
  connectionCreatedAt: Date;
}

function grantBrowserReason(input: GrantCheck): BrowserReason | undefined {
  const grant = input.delegation;
  if (!input.executeEnabled || !grant?.activatedAt)
    return 'inactive_delegation';
  if (
    grant.status === 'expired' ||
    (grant.status === 'active' && grantExpired(grant.expiresAt))
  )
    return 'delegation_expired';
  if (grant.status !== 'active') return 'inactive_delegation';
  if (input.signerPolicyId && grant.policyId !== input.signerPolicyId)
    return 'delegation_policy_changed';
  if (input.connectionCreatedAt <= grant.activatedAt)
    return 'execute_consent_outdated';
  return undefined;
}

/** True when a Jupiter quote on this connection can be signed in chat. */
export function canSignInChat(input: GrantCheck): boolean {
  return (
    !grantBrowserReason(input) &&
    input.slippageBps <= input.delegation!.maxSlippageBps &&
    (input.side === 'buy' || input.delegation!.allowSell)
  );
}

export function delegatedModeDecision(
  input: GrantCheck & { provider: string; sellPriced: boolean },
): {
  delegated: boolean;
  signingGrant: 'active' | 'inactive';
  browserReason?: BrowserReason;
  message?: string;
} {
  const grant = input.delegation;
  const grantReason = grantBrowserReason(input);
  if (grantReason)
    return {
      delegated: false,
      signingGrant:
        grantReason === 'execute_consent_outdated' ? 'active' : 'inactive',
      browserReason: grantReason,
      message: BROWSER_MESSAGES[grantReason],
    };
  let browserReason: BrowserReason | undefined;
  if (input.provider !== 'jupiter') browserReason = 'unsupported_venue';
  else if (input.slippageBps > grant!.maxSlippageBps)
    browserReason = 'slippage_above_grant';
  else if (input.side === 'sell' && !grant!.allowSell)
    browserReason = 'sells_not_allowed';
  else if (input.side === 'sell' && !input.sellPriced)
    browserReason = 'unpriced_sell';
  if (!browserReason) return { delegated: true, signingGrant: 'active' };
  return {
    delegated: false,
    signingGrant: 'active',
    browserReason,
    message: BROWSER_MESSAGES[browserReason],
  };
}
