import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mcpConnectorForKind } from '../services/mcp-connector.ts';

const require = createRequire(import.meta.url);
const auth = { ready: true, authenticated: true, configured: true, address: 'wallet', email: 'test@example.com' };
function load(path, states, mocks = {}) {
  let index = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, process: { env: {} }, require(id) {
    if (id in mocks) return mocks[id];
    if (id === 'react') return { ...React, useEffect() {}, useCallback: fn => fn, useState: initial => [index < states.length ? states[index++] : initial, () => {}] };
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => auth };
    if (id === '@/services/mcp-api-origin') return { mcpApiOrigin: () => 'https://api.example.com' };
    if (id === '@/components/brand/agent-client') return { agentClient: mcpConnectorForKind, AgentClientLogo: ({ kind }) => React.createElement('img', { src: mcpConnectorForKind(kind)?.logo ?? '/generic.svg', alt: '' }) };
    if (id === '@/components/ui') return { Button: ({ children, size, variant, ...props }) => React.createElement('button', props, children), formatDate: (value) => String(value ?? "") };
    if (id === 'next/link') return { default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (id.endsWith('.module.css')) return { default: {} };
    if (id === '@hugeicons/react') return { HugeiconsIcon: () => null };
    if (id === '@hugeicons/core-free-icons' || id === '@/services/mcp-grant-authorization') return {};
    if (id === './trade-grant-editor') return { TradeGrantEditor: () => React.createElement('form', { 'data-editor': true }) };
    if (id === './connection-next-step') return { ConnectionNextStep: () => null };
    return require(id);
  } });
  return exports;
}

test('six connections retain client names, logos, distinct grant details and one limits panel above the list', () => {
  const connections = ['claude', 'cursor', 'codex', 'claude', 'cursor', null].map((clientKind, index) => ({
    clientKind, grantId: `grant-${index}`, clientId: `client-${index}`, wallet: 'wallet',
    scopes: 'oren.read oren.trade.execute', createdAt: '2026-11-07T12:00:00Z', nativeClient: clientKind === 'codex',
  }));
  const { AgentConnections } = load('../components/settings/agent-connections.tsx', [{ connections, loading: false }], {
    '@/app/settings/mcp/trade-grant': { TradeGrant: ({ connectionUid }) => React.createElement('section', { id: 'chat-trading', 'data-uid': connectionUid }) },
  });
  const html = renderToStaticMarkup(React.createElement(AgentConnections, { connectionUid: 'pending_42' }));
  assert.equal((html.match(/id="chat-trading"/g) ?? []).length, 1);
  assert.ok(html.indexOf('id="chat-trading"') < html.indexOf('id="connected-apps-heading"'));
  assert.match(html, /data-uid="pending_42"/);
  for (const kind of ['claude', 'cursor', 'codex']) assert.match(html, new RegExp(`/integrations/${kind}.svg`));
  for (let index = 0; index < 6; index++) assert.match(html, new RegExp(`grant-${index}`));
  assert.match(html, /Agent connection 6/);
  assert.match(html, /Oren cannot verify the receiving app/);
});

function renderGrant(grant, acknowledged = false) {
  const { TradeGrant } = load('../app/settings/mcp/trade-grant.tsx', [grant, undefined, acknowledged]);
  return renderToStaticMarkup(React.createElement(TradeGrant, {}));
}

test('legacy permission shows an actionable renewal without empty limits or contradictory enrollment copy', () => {
  const html = renderGrant({ enabled: false, reenrollmentRequired: true, delegationId: 'old-grant', wallet: 'wallet' }, true);
  assert.match(html, /Revoke old permission to set new limits/);
  assert.doesNotMatch(html, /Up to \$|Maximum slippage|Expires:|not available for this account|disabled=""/);
  assert.match(html, /id="chat-trading"/);
});

test('renewal still requires acknowledgement and the matching wallet', () => {
  for (const [wallet, acknowledged] of [['wallet', false], ['other-wallet', true]]) {
    assert.match(renderGrant({ enabled: false, reenrollmentRequired: true, delegationId: 'old-grant', wallet }, acknowledged), /disabled=""/);
  }
});

test('eligible new permissions show the editor and unavailable accounts retain their explanation', () => {
  assert.match(renderGrant({ enabled: false, canEnroll: true }), /data-editor="true"/);
  assert.match(renderGrant({ enabled: false, canEnroll: false }), /not available for this account/);
});
