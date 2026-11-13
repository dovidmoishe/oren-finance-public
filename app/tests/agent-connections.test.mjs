import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../components/settings/agent-connections.tsx', import.meta.url), 'utf8');

// Exercise the real component's effects and actions with a controllable account/API.
function fixture({ authenticated = true, ready = true, apiOrigin = 'https://api.example.test', fetch } = {}) {
  const slots = [], effects = [], buttons = [];
  let cursor = 0;
  const auth = { authenticated, ready, configured: true, email: 'test@example.test', getAccessToken: async () => 'test-token', open() {} };
  const compiled = { exports: {} };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useEffect(effect) { effects.push(effect); },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: compiled, exports: compiled.exports, AbortController, fetch,
    require(name) {
      if (name === 'react') return hooks;
      if (name === '@/components/auth/auth-context') return { useOrenAuth: () => auth };
      if (name === '@/services/mcp-api-origin') return { mcpApiOrigin: () => apiOrigin };
      if (name === 'next/link') return { default: ({ children, ...props }) => createElement('a', props, children) };
      if (name === '@hugeicons/core-free-icons') return {};
      if (name === '@hugeicons/react') return { HugeiconsIcon: () => null };
      if (name === '@/components/brand/agent-client') return { agentClient: () => undefined, AgentClientLogo: () => null };
      if (name === '@/app/settings/mcp/trade-grant') return { TradeGrant: ({ connectionUid }) => createElement('section', { 'data-connection': connectionUid }, 'Chat trading permission') };
      if (name === '@/components/ui') return { Button: ({ children, ...props }) => { buttons.push(props); return createElement(props.href ? 'a' : 'button', props, children); }, formatDate: (value) => String(value ?? "") };
      return require(name);
    },
  });
  return {
    auth, buttons,
    render(connectionUid) { cursor = 0; buttons.length = 0; effects.length = 0; return renderToStaticMarkup(compiled.exports.AgentConnections({ connectionUid })); },
    async load() { effects[0](); await new Promise(resolve => setImmediate(resolve)); },
    key() { return compiled.exports.AgentConnections().key; },
  };
}

test('waits for authentication and never shows the empty state before the request completes', async () => {
  const f = fixture({ fetch: async () => ({ ok: true, json: async () => [] }) });
  assert.match(f.render(), /Loading connections/);
  assert.doesNotMatch(f.render(), /Connect your first agent/);
  await f.load();
  assert.match(f.render(), /Connect your first agent/);
  const loading = fixture({ ready: false });
  assert.match(loading.render(), /Loading your account/);
  assert.doesNotMatch(loading.render(), /Sign in to Oren/);
});

test('signed-out and missing-API states are explicit', () => {
  assert.match(fixture({ authenticated: false }).render(), /Sign in to Oren/);
  assert.match(fixture({ apiOrigin: null }).render(), /Connections are unavailable/);
});

test('load failure offers retry and does not report zero connections', async () => {
  const f = fixture({ fetch: async () => ({ ok: false }) });
  f.render(); await f.load();
  assert.match(f.render(), /Unable to load connections/);
  assert.doesNotMatch(f.render(), /Connect your first agent/);
  assert.ok(f.buttons.some(button => button.onClick));
});

test('failed revoke preserves the connection; successful revoke removes it after the response', async () => {
  let allowRevoke = false;
  const calls = [];
  const row = { grantId: 'grant/a', clientId: 'untrusted-client-id', wallet: 'wallet', scopes: 'oren.trade.execute', createdAt: '2026-11-05T12:00:00Z' };
  const f = fixture({ fetch: async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST' ? { ok: allowRevoke } : { ok: true, json: async () => [row] };
  } });
  f.render(); await f.load();
  assert.match(f.render(), /Chat trading/);
  await f.buttons.find(button => button['aria-label'] === 'Revoke agent connection 1').onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.render(), /Unable to revoke/);
  assert.match(f.render(), /untrusted-client-id/);
  allowRevoke = true;
  await f.buttons.find(button => button['aria-label'] === 'Revoke agent connection 1').onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.render(), /Connection revoked/);
  assert.doesNotMatch(f.render(), /untrusted-client-id/);
  assert.equal(calls.at(-1).url, 'https://api.example.test/oauth/connections/grant%2Fa/revoke');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-token');
});

test('changing accounts remounts connection and trading state', () => {
  const f = fixture();
  const before = f.key();
  f.auth.email = 'another@example.test';
  assert.notEqual(f.key(), before);
});


test('pending interaction reaches the trading permission continuation', () => {
  assert.match(fixture().render('pending_42'), /data-connection="pending_42"/);
});
