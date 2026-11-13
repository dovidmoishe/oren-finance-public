import { canSignInChat, delegatedModeDecision } from './delegated-mode';

const grant = {
  activatedAt: new Date('2026-11-10T00:00:00Z'),
  expiresAt: new Date(Date.now() + 60_000),
  status: 'active',
  policyId: 'current-policy',
  maxSlippageBps: 50,
  allowSell: true,
};
const connectedAfter = new Date('2026-11-10T01:00:00Z');

describe('delegated mode reasons', () => {
  it('requires fresh execution consent after the owner renews a grant', () => {
    const input = {
      executeEnabled: true,
      provider: 'jupiter',
      slippageBps: 50,
      side: 'buy' as const,
      delegation: grant,
      connectionCreatedAt: grant.activatedAt,
      sellPriced: false,
    };
    expect(canSignInChat(input)).toBe(false);
    expect(delegatedModeDecision(input)).toMatchObject({
      delegated: false,
      signingGrant: 'active',
      browserReason: 'execute_consent_outdated',
    });
  });

  it('keeps an active grant when the quote venue cannot be signed in chat', () => {
    const decision = delegatedModeDecision({
      executeEnabled: true,
      provider: 'titan:Titan-DART',
      slippageBps: 50,
      side: 'buy',
      delegation: grant,
      connectionCreatedAt: connectedAfter,
      sellPriced: false,
    });
    expect(decision).toMatchObject({
      delegated: false,
      signingGrant: 'active',
      browserReason: 'unsupported_venue',
    });
    expect(decision.message).toContain('signing grant is still active');
    expect(decision.message).toContain('not a missing signing permission');
  });

  it('reports a missing grant as inactive and a jupiter buy as delegated', () => {
    expect(
      delegatedModeDecision({
        executeEnabled: true,
        provider: 'jupiter',
        slippageBps: 50,
        side: 'buy',
        delegation: null,
        connectionCreatedAt: connectedAfter,
        sellPriced: false,
      }),
    ).toMatchObject({
      delegated: false,
      signingGrant: 'inactive',
      browserReason: 'inactive_delegation',
    });
    expect(
      delegatedModeDecision({
        executeEnabled: true,
        provider: 'jupiter',
        slippageBps: 50,
        side: 'buy',
        delegation: grant,
        connectionCreatedAt: connectedAfter,
        sellPriced: false,
      }).delegated,
    ).toBe(true);
  });

  it('asks for a Jupiter quote only when chat signing can use it', () => {
    expect(
      canSignInChat({
        executeEnabled: true,
        slippageBps: 50,
        side: 'buy',
        delegation: grant,
        connectionCreatedAt: connectedAfter,
      }),
    ).toBe(true);
    expect(
      canSignInChat({
        executeEnabled: true,
        slippageBps: 50,
        side: 'buy',
        delegation: null,
        connectionCreatedAt: connectedAfter,
      }),
    ).toBe(false);
  });
});
