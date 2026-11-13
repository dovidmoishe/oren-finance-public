import {
  gatePolicyFingerprint,
  gatePolicyRulesValid,
  SignerGateService,
} from '../signer-gate/signer-gate.service';

jest.mock('@privy-io/node', () =>
  jest.requireActual<typeof import('../test/privy-authorization.mock')>(
    '../test/privy-authorization.mock',
  ),
);

function policy() {
  return {
    owner_id: 'offline-owner',
    chain_type: 'solana',
    version: '1.0',
    rules: Array.from({ length: 16 }, (_, i) => ({
      name:
        i === 0
          ? 'allow bounded jupiter buy'
          : i === 1
            ? 'allow bounded jupiter sell'
            : `reviewed-rule-${i}`,
      method: 'signTransaction',
      action: i < 2 ? 'ALLOW' : 'DENY',
      conditions: [
        {
          field_source: 'system',
          field: 'current_unix_timestamp',
          operator: 'gte',
          value: '2000000000',
        },
      ],
    })),
  };
}

describe('public sell policy compatibility', () => {
  it('accepts bounded chunked policies and preserves the three-rule buy pilot', () => {
    const p = policy();
    expect(gatePolicyRulesValid(p as never, true)).toBe(true);
    expect(gatePolicyRulesValid(p as never, false)).toBe(false);
    p.rules = p.rules.slice(0, 3);
    expect(gatePolicyRulesValid(p as never, false)).toBe(true);
    expect(gatePolicyRulesValid(p as never, true)).toBe(false);
  });
  it('rejects policies without both sides, with unexpected methods, or excessive rule counts', () => {
    const p = policy();
    p.rules[1].name = 'other';
    expect(gatePolicyRulesValid(p as never, true)).toBe(false);
    p.rules[1].name = 'allow bounded jupiter sell';
    p.rules[1].method = 'signAndSendTransaction';
    expect(gatePolicyRulesValid(p as never, true)).toBe(false);
    p.rules[1].method = 'signTransaction';
    p.rules.push(...Array.from({ length: 40 }, () => p.rules[0]));
    expect(gatePolicyRulesValid(p as never, true)).toBe(false);
  });
  it('accepts the compact until-revoked policy with the required allow rules', () => {
    const p = policy();
    p.rules = p.rules.slice(0, 3).map((rule) => ({
      ...rule,
      action: 'ALLOW',
      conditions: [],
    }));
    p.rules[2].name = 'allow compute budget';
    expect(gatePolicyRulesValid(p as never, true)).toBe(true);
    p.rules[2].action = 'DENY';
    expect(gatePolicyRulesValid(p as never, true)).toBe(false);
  });
  it('still rejects any changed rule through the independently pinned fingerprint', async () => {
    const p = policy();
    const config = {
      enabled: true,
      policyId: 'new-policy',
      policyOwnerId: 'offline-owner',
      sellsEnabled: true,
      policyHash: gatePolicyFingerprint(p as never),
    };
    const service = new SignerGateService(
      config as never,
      {
        privy: { policies: () => ({ get: () => Promise.resolve(p) }) },
      } as never,
    );
    const verify = () =>
      (
        service as unknown as { verifyPolicy(): Promise<typeof p> }
      ).verifyPolicy();
    await expect(verify()).resolves.toBe(p);
    p.rules[2].conditions[0].value = '3000000000';
    await expect(verify()).rejects.toThrow('owner-reviewed');
  });
});
