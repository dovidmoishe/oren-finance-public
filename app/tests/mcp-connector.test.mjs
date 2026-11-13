import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpConnector, mcpConnectorForKind } from '../services/mcp-connector.ts';

test('brands each supported selected callback consistently with the API allowlist', () => {
  for (const [callback, name] of [
    ['https://claude.ai/api/mcp/auth_callback', 'Claude'],
    ['https://www.cursor.com/agents/mcp/oauth/callback', 'Cursor'],
    ['http://localhost:8787/callback', 'Cursor'],
    ['cursor://anysphere.cursor-mcp/oauth/callback', 'Cursor'],
    ['http://127.0.0.1:45678/callback', 'Codex'],
    ['http://127.0.0.1:45678/callback/abcdefgh_123', 'Codex'],
  ]) {
    assert.equal(mcpConnector(callback)?.name, name);
    assert.equal(mcpConnector(callback)?.logo, `/integrations/${name.toLowerCase()}.svg`);
  }
});

test('unrecognized or lookalike callbacks keep the generic app presentation', () => {
  for (const callback of [
    undefined, '', 'invalid',
    'https://claude.ai.evil.test/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback?next=evil',
    'https://www.cursor.com.evil.test/agents/mcp/oauth/callback',
    'cursor://evil.cursor-mcp/oauth/callback',
    'http://localhost:9999/callback',
    'http://127.0.0.1:45678/callback?next=evil',
    'http://127.0.0.1:45678/callback#evil',
    'http://user@127.0.0.1:45678/callback',
    'http://127.0.0.1:45678/callback/short',
    'http://127.0.0.1.evil.test:45678/callback',
    'https://127.0.0.1:45678/callback',
  ]) assert.equal(mcpConnector(callback), undefined, callback);
});


test('stored connection families reuse the consent names and logos with a safe fallback', () => {
  for (const [kind, callback] of [['claude', 'https://claude.ai/api/mcp/auth_callback'], ['cursor', 'https://www.cursor.com/agents/mcp/oauth/callback'], ['codex', 'http://127.0.0.1:45678/callback']]) {
    assert.deepEqual(mcpConnectorForKind(kind), mcpConnector(callback));
  }
  for (const kind of [undefined, null, '', 'unknown', '__proto__', 'constructor']) assert.equal(mcpConnectorForKind(kind), undefined);
});
