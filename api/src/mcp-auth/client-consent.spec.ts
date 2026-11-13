import {
  describeMcpConsentClient,
  nativeMcpConsentGranted,
} from './client-consent';

const WEB = 'https://www.cursor.com/agents/mcp/oauth/callback';
const LOCAL = 'http://localhost:8787/callback';
const SCHEME = 'cursor://anysphere.cursor-mcp/oauth/callback';
const CODEX = 'http://127.0.0.1:49152/callback/Abcdef12_-';

function client(redirectUris: string[]) {
  return {
    redirectUris,
    redirectUriAllowed: (value: string) => redirectUris.includes(value),
  };
}

describe('MCP client consent destination', () => {
  it.each([LOCAL, SCHEME, CODEX])(
    'requires acknowledgement for local callbacks: %s',
    (callback) => {
      const result = describeMcpConsentClient(client([callback]), callback)!;
      expect(result.callbackUrl).toBe(callback);
      expect(result.requiresNativeConsent).toBe(true);
      for (const value of [undefined, false, 'false', 'TRUE', ['true']])
        expect(nativeMcpConsentGranted(result, value)).toBe(false);
      expect(nativeMcpConsentGranted(result, 'true')).toBe(true);
    },
  );

  it('uses the selected callback even when HTTPS is registered first', () => {
    const registration = client([WEB, LOCAL, SCHEME]);
    const local = describeMcpConsentClient(registration, LOCAL)!;
    expect(local.callbackDestination).toBe('http://localhost:8787');
    expect(local.requiresNativeConsent).toBe(true);
    const web = describeMcpConsentClient(registration, WEB)!;
    expect(web.callbackDestination).toBe('https://www.cursor.com');
    expect(web.requiresNativeConsent).toBe(false);
    expect(nativeMcpConsentGranted(web, undefined)).toBe(true);
  });

  it('preserves provider-approved ephemeral native loopback ports', () => {
    const registration = client([WEB, LOCAL]);
    // oidc-provider permits a different port for native loopback callbacks.
    registration.redirectUriAllowed = (value) =>
      value === 'http://localhost:49153/callback';
    expect(
      describeMcpConsentClient(registration, 'http://localhost:49153/callback'),
    ).toEqual({
      callbackUrl: 'http://localhost:49153/callback',
      callbackDestination: 'http://localhost:49153',
      requiresNativeConsent: true,
    });
  });

  it.each([
    undefined,
    null,
    [],
    '',
    'https://attacker.example/callback',
    CODEX,
  ])(
    'fails closed on missing or unregistered selected callback: %s',
    (selected) => {
      expect(
        describeMcpConsentClient(client([WEB, LOCAL]), selected),
      ).toBeUndefined();
    },
  );

  it('fails closed on unsupported or mixed registrations', () => {
    expect(describeMcpConsentClient(client([WEB, CODEX]), WEB)).toBeUndefined();
    expect(
      describeMcpConsentClient(
        client(['https://attacker.example/callback']),
        'https://attacker.example/callback',
      ),
    ).toBeUndefined();
  });
});
