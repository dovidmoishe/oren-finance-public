import { mcpClientKind } from './oauth-runtime';

export interface McpConsentClient {
  callbackUrl: string;
  callbackDestination: string;
  requiresNativeConsent: boolean;
}

/** Describe the selected callback, never a self-declared app name or another URI. */
export function describeMcpConsentClient(
  client: {
    redirectUris?: readonly string[];
    redirectUriAllowed(value: string): boolean;
  },
  redirectUri: unknown,
): McpConsentClient | undefined {
  const kind = mcpClientKind(client.redirectUris);
  if (
    !kind ||
    typeof redirectUri !== 'string' ||
    !client.redirectUriAllowed(redirectUri)
  )
    return undefined;
  const callback = new URL(redirectUri);
  return {
    callbackUrl: callback.href,
    callbackDestination: `${callback.protocol}//${callback.host}`,
    // Loopback and private-use schemes cannot attest the receiving app. A
    // Cursor registration may contain HTTPS and native callbacks together.
    requiresNativeConsent: callback.protocol !== 'https:',
  };
}

export function nativeMcpConsentGranted(
  client: McpConsentClient,
  acknowledgment: unknown,
): boolean {
  return !client.requiresNativeConsent || acknowledgment === 'true';
}
