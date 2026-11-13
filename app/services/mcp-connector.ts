const CONNECTORS = {
  claude: { name: 'Claude', logo: '/integrations/claude.svg' },
  cursor: { name: 'Cursor', logo: '/integrations/cursor.svg' },
  codex: { name: 'Codex', logo: '/integrations/codex.svg' },
};

export function mcpConnectorForKind(kind?: string | null) {
  return kind && Object.hasOwn(CONNECTORS, kind) ? CONNECTORS[kind as keyof typeof CONNECTORS] : undefined;
}

/** Presentation only: a native callback does not attest the receiving app. */
export function mcpConnector(callbackUrl?: string) {
  if (!callbackUrl) return undefined;
  switch (callbackUrl) {
    case 'https://claude.ai/api/mcp/auth_callback':
      return CONNECTORS.claude;
    case 'https://www.cursor.com/agents/mcp/oauth/callback':
    case 'http://localhost:8787/callback':
    case 'cursor://anysphere.cursor-mcp/oauth/callback':
      return CONNECTORS.cursor;
  }
  try {
    const callback = new URL(callbackUrl);
    if (
      callback.protocol === 'http:' &&
      callback.hostname === '127.0.0.1' &&
      !callback.username && !callback.password &&
      !callback.search && !callback.hash &&
      /^\/callback(?:\/[A-Za-z0-9_-]{8,128})?$/.test(callback.pathname)
    ) return CONNECTORS.codex;
  } catch { /* Unknown callbacks keep the generic app presentation. */ }
  return undefined;
}
