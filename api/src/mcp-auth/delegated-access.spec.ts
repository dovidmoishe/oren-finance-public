import { delegatedUserAllowed } from './delegated-access';

describe('delegatedUserAllowed', () => {
  const allowedUsers = new Set(['did:privy:owner']);

  it('keeps the named allowlist when public access is off', () => {
    expect(delegatedUserAllowed({ allowedUsers }, 'did:privy:owner')).toBe(
      true,
    );
    expect(delegatedUserAllowed({ allowedUsers }, 'did:privy:other')).toBe(
      false,
    );
    expect(
      delegatedUserAllowed(
        { allowedUsers, publicAccess: false },
        'did:privy:other',
      ),
    ).toBe(false);
  });

  it('allows any verified user when public access is on', () => {
    expect(
      delegatedUserAllowed(
        { allowedUsers: new Set(), publicAccess: true },
        'did:privy:other',
      ),
    ).toBe(true);
  });

  it('never allows a missing user, even when public', () => {
    const open = { allowedUsers: new Set(['']), publicAccess: true };
    expect(delegatedUserAllowed(open, undefined)).toBe(false);
    expect(delegatedUserAllowed(open, '')).toBe(false);
    expect(delegatedUserAllowed(open, '   ')).toBe(false);
  });

  it('does not treat a literal * entry as public access', () => {
    expect(
      delegatedUserAllowed({ allowedUsers: new Set(['*']) }, 'did:privy:other'),
    ).toBe(false);
  });
});
