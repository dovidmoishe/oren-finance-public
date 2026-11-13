import type Provider from 'oidc-provider';
import { createMcpOAuthAdapter } from './oauth-adapter';
import type { Database } from '../database/database.provider';

export interface McpOAuthRuntime {
  provider: Provider;
  issuer: string;
  appOrigin: string;
  resource: string;
}

/** Let oidc-provider scope its interaction cookie to the API callback. */
export function mcpInteractionUrl(issuer: string, uid: string): string {
  return `${issuer}/interaction/${encodeURIComponent(uid)}?launch=1`;
}

/** Preserve the OAuth issuer mount when serving RFC 8414 path discovery. */
export function mountPathBasedDiscoveryAtIssuer(request: {
  url: string;
  baseUrl: string;
  originalUrl: string;
}): void {
  request.url = '/.well-known/oauth-authorization-server';
  request.baseUrl = '/oauth';
  request.originalUrl = `/oauth${request.url}`;
}

export type McpClientKind = 'claude' | 'cursor' | 'codex';

/** Exact callbacks published by Claude.ai and Cursor (desktop, legacy scheme, web). */
const FIXED_REDIRECTS: Record<string, McpClientKind> = {
  'https://claude.ai/api/mcp/auth_callback': 'claude',
  'http://localhost:8787/callback': 'cursor',
  'cursor://anysphere.cursor-mcp/oauth/callback': 'cursor',
  'https://www.cursor.com/agents/mcp/oauth/callback': 'cursor',
};

/** Codex loopback: http://127.0.0.1[:port]/callback[/<callback id>]. */
function isCodexLoopback(value: string): boolean {
  let redirect: URL;
  try {
    redirect = new URL(value);
  } catch {
    return false;
  }
  return (
    redirect.protocol === 'http:' &&
    redirect.hostname === '127.0.0.1' &&
    !redirect.username &&
    !redirect.password &&
    !redirect.search &&
    !redirect.hash &&
    /^\/callback(?:\/[A-Za-z0-9_-]{8,128})?$/.test(redirect.pathname)
  );
}

export function mcpRedirectKind(value: string): McpClientKind | undefined {
  return (
    FIXED_REDIRECTS[value] ?? (isCodexLoopback(value) ? 'codex' : undefined)
  );
}

/** Public client registration is limited to Claude.ai, Cursor and Codex. */
export function isSupportedMcpRedirect(value: string): boolean {
  return mcpRedirectKind(value) !== undefined;
}

/**
 * The client a registration belongs to. Cursor may register several of its own
 * callbacks at once; a registration mixing different clients' callbacks has no
 * single kind and stays read-only.
 */
export function mcpClientKind(
  redirectUris?: readonly string[],
): McpClientKind | undefined {
  if (!redirectUris?.length || redirectUris.length > 4) return undefined;
  const kinds = new Set(redirectUris.map(mcpRedirectKind));
  if (kinds.size !== 1) return undefined;
  return [...kinds][0];
}

/**
 * Supported clients may prepare trades. Every trade still needs either browser
 * review or an owner-signed, budget-limited delegation grant.
 */
export function clientMayPrepareTrades(
  redirectUris?: readonly string[],
): boolean {
  return mcpClientKind(redirectUris) !== undefined;
}

/** Execution also requires explicit consent and an active delegation. */
export const clientMayExecuteTrades = clientMayPrepareTrades;

/** Disabled by default; partial configuration must fail startup, not weaken auth. */
export async function createMcpOAuthRuntime(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpOAuthRuntime | undefined> {
  if (env.MCP_OAUTH_ENABLED !== 'true') return undefined;
  const executeScopeEnabled = env.MCP_DELEGATED_TRADES_ENABLED === 'true';
  const issuer = env.MCP_OAUTH_ISSUER?.trim();
  const appOrigin = env.MCP_APP_ORIGIN?.trim();
  const storageKey = Buffer.from(env.MCP_OAUTH_STORAGE_KEY ?? '', 'base64');
  const cookieKeys = (env.MCP_OAUTH_COOKIE_KEYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const jwksJson = env.MCP_OAUTH_JWKS;
  if (
    !issuer ||
    !appOrigin ||
    storageKey.length < 32 ||
    cookieKeys.length < 2 ||
    cookieKeys.some((key) => key.length < 32) ||
    !jwksJson
  )
    throw new Error('MCP OAuth configuration is incomplete');
  const issuerUrl = new URL(issuer);
  const appUrl = new URL(appOrigin);
  if (
    issuerUrl.search ||
    issuerUrl.hash ||
    issuerUrl.username ||
    issuerUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    appUrl.username ||
    appUrl.password
  )
    throw new Error('MCP OAuth URLs must be plain origins');
  const local =
    env.NODE_ENV !== 'production' && issuerUrl.hostname === 'localhost';
  if (
    (issuerUrl.protocol !== 'https:' && !local) ||
    appUrl.protocol !== 'https:'
  )
    throw new Error('MCP OAuth requires HTTPS');
  if (issuerUrl.pathname !== '/oauth' || appUrl.pathname !== '/')
    throw new Error('Unexpected MCP OAuth origin path');
  const resource = `${issuerUrl.origin}/mcp`;
  const jwks = JSON.parse(jwksJson) as { keys: Record<string, unknown>[] };
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1)
    throw new Error('MCP OAuth signing key is missing');
  const {
    default: OidcProvider,
    errors,
    interactionPolicy,
  } = await import('oidc-provider');
  const policy = interactionPolicy.base();
  // A callback is not app attestation. Require Oren's consent on each new
  // authorization, including existing native registrations labelled "web".
  // Resuming this same interaction after our consent POST must still complete.
  policy
    .get('consent')!
    .checks.add(
      new interactionPolicy.Check(
        'oren_connection_consent',
        'each agent connection requires explicit Oren consent',
        'consent_required',
        ({ oidc }) => !oidc.result?.consent,
      ),
    );
  const provider = new OidcProvider(issuer, {
    adapter: createMcpOAuthAdapter(db, storageKey),
    jwks,
    cookies: { keys: cookieKeys },
    pkce: { required: () => true },
    responseTypes: ['code'],
    // Claude includes MCP permissions in dynamic client metadata. The provider
    // validates that metadata against this list and also checks these scopes
    // against the OP grant during consent.
    scopes: [
      'openid',
      'oren.read',
      'oren.trade.prepare',
      ...(executeScopeEnabled ? ['oren.trade.execute'] : []),
      'offline_access',
    ],
    clientAuthMethods: ['none'],
    rotateRefreshToken: true,
    issueRefreshToken: () => true,
    ttl: {
      AccessToken: 600,
      RefreshToken: 7 * 24 * 60 * 60,
      Grant: 7 * 24 * 60 * 60,
    },
    findAccount: (_context, accountId) => ({
      accountId,
      claims: () => ({ sub: accountId }),
    }),
    interactions: {
      policy,
      url: (_context, interaction) =>
        mcpInteractionUrl(issuer, interaction.uid),
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true, initialAccessToken: false },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (_context, requested) => {
          if (requested !== resource) throw new errors.InvalidTarget();
          return {
            scope: `oren.read oren.trade.prepare${executeScopeEnabled ? ' oren.trade.execute' : ''}`,
            audience: resource,
            accessTokenTTL: 600,
          };
        },
        defaultResource: () => resource,
      },
    },
    extraClientMetadata: {
      properties: ['oren_client_policy'],
      validator: (context, _key, _value, metadata) => {
        if (!context) return;
        if (
          !mcpClientKind(metadata.redirect_uris) ||
          metadata.token_endpoint_auth_method !== 'none' ||
          metadata.response_types?.join(' ') !== 'code' ||
          !metadata.grant_types?.includes('authorization_code')
        )
          throw new errors.InvalidClientMetadata('Unsupported MCP client');
      },
    },
  });
  provider.proxy = true;
  return { provider, issuer, appOrigin: appUrl.origin, resource };
}
