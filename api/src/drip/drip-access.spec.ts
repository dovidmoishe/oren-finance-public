import { dripToolsEnabled, type DripAccessConfig } from './drip-access';

const open: DripAccessConfig = {
  enabled: true,
  publicResearch: true,
};

describe('dripToolsEnabled', () => {
  const caller = { userId: 'did:privy:owner', walletAddress: 'wallet-owner' };

  it('stays off when the provider flag is off', () => {
    expect(dripToolsEnabled({ ...open, enabled: false }, caller)).toBe(false);
  });

  it('stays off when signed-in research is disabled', () => {
    expect(dripToolsEnabled({ ...open, publicResearch: false }, caller)).toBe(
      false,
    );
  });

  it('accepts a verified user and linked wallet without an email allowlist', () => {
    expect(dripToolsEnabled(open, caller)).toBe(true);
    expect(
      dripToolsEnabled(open, {
        email: 'owner@example.com',
        walletAddress: 'wallet-owner',
      }),
    ).toBe(false);
    expect(
      dripToolsEnabled(open, {
        userId: caller.userId,
      }),
    ).toBe(false);
  });
});
