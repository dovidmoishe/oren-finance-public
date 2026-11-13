import {
  clientMayPrepareTrades,
  clientMayExecuteTrades,
  isSupportedMcpRedirect,
  mcpClientKind,
} from './oauth-runtime';

const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CURSOR_DESKTOP = 'http://localhost:8787/callback';
const CURSOR_LEGACY = 'cursor://anysphere.cursor-mcp/oauth/callback';
const CURSOR_WEB = 'https://www.cursor.com/agents/mcp/oauth/callback';
const CODEX = 'http://127.0.0.1:49152/callback/Abcdef12_-';

describe('MCP client redirect allowlist', () => {
  it.each([
    CLAUDE,
    CURSOR_DESKTOP,
    CURSOR_LEGACY,
    CURSOR_WEB,
    'http://127.0.0.1/callback',
    'http://127.0.0.1:49152/callback',
    CODEX,
  ])('allows an exact supported callback: %s', (value) => {
    expect(isSupportedMcpRedirect(value)).toBe(true);
  });

  it.each([
    'https://claude.ai.evil.test/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback?next=evil',
    'http://127.0.0.2:49152/callback',
    'http://localhost:49152/callback',
    'http://localhost:8788/callback',
    'http://localhost:8787/callback?next=evil',
    'http://localhost:8787/callback/extra',
    'cursor://anysphere.cursor-mcp/oauth/callback/evil',
    'cursor://evil.cursor-mcp/oauth/callback',
    'https://cursor.com/agents/mcp/oauth/callback',
    'https://www.cursor.com.evil.test/agents/mcp/oauth/callback',
    'https://127.0.0.1:49152/callback',
    'http://127.0.0.1:49152/callback/../../steal',
    'http://127.0.0.1:49152/callback?next=evil',
    'http://127.0.0.1:49152/callback#fragment',
    'http://user@127.0.0.1:49152/callback',
  ])('rejects other callbacks: %s', (value) => {
    expect(isSupportedMcpRedirect(value)).toBe(false);
  });
});

describe('MCP client kind', () => {
  it('recognises each supported client', () => {
    expect(mcpClientKind([CLAUDE])).toBe('claude');
    expect(mcpClientKind([CODEX])).toBe('codex');
    expect(mcpClientKind([CURSOR_DESKTOP])).toBe('cursor');
  });

  it('accepts Cursor registering several of its own callbacks', () => {
    expect(mcpClientKind([CURSOR_DESKTOP, CURSOR_LEGACY, CURSOR_WEB])).toBe(
      'cursor',
    );
  });

  it('rejects mixed, unknown, empty and oversized registrations', () => {
    expect(mcpClientKind([CLAUDE, CODEX])).toBeUndefined();
    expect(mcpClientKind([CURSOR_DESKTOP, CLAUDE])).toBeUndefined();
    expect(
      mcpClientKind([CURSOR_DESKTOP, 'https://attacker.example/cb']),
    ).toBeUndefined();
    expect(mcpClientKind([])).toBeUndefined();
    expect(mcpClientKind(undefined)).toBeUndefined();
    expect(
      mcpClientKind([
        CURSOR_DESKTOP,
        CURSOR_LEGACY,
        CURSOR_WEB,
        CURSOR_DESKTOP,
        CURSOR_LEGACY,
      ]),
    ).toBeUndefined();
  });
});

describe('MCP client trade scope', () => {
  it.each([
    ['Claude.ai', [CLAUDE]],
    ['Codex', [CODEX]],
    ['Cursor', [CURSOR_DESKTOP, CURSOR_LEGACY]],
  ])('lets %s prepare and execute trades', (_name, uris) => {
    expect(clientMayPrepareTrades(uris)).toBe(true);
    expect(clientMayExecuteTrades(uris)).toBe(true);
  });

  it('keeps mixed or unknown registrations away from trade scopes', () => {
    expect(clientMayPrepareTrades(undefined)).toBe(false);
    expect(clientMayExecuteTrades([CLAUDE, 'http://127.0.0.1/callback'])).toBe(
      false,
    );
    expect(clientMayPrepareTrades(['https://attacker.example/cb'])).toBe(false);
  });
});
