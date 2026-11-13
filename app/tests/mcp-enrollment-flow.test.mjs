import assert from 'node:assert/strict';
import test from 'node:test';
import { mcpEnrollmentLinks } from '../services/mcp-enrollment-flow.ts';
import { grantDurationOptions, parseGrantSettings } from '../services/mcp-grant-settings.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const messages = JSON.parse(readFileSync(new URL('../i18n/messages/en.json', import.meta.url), 'utf8'));
function loadComponent(path, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id) {
    if (id in mocks) return mocks[id];
    if (id.endsWith('.module.css')) return { default: {} };
    if (id === 'next/link') return { default: ({ children, ...props }) => createElement('a', props, children) };
    if (id === '@/services/mcp-enrollment-flow') return { mcpEnrollmentLinks };
    if (id === '@/services/mcp-grant-settings') return { grantDurationOptions, parseGrantSettings };
    if (id === '@/i18n/i18n') return { useI18n: () => ({
      locale: 'en',
      t: (key, values = {}) => key.split('.').reduce((value, part) => value[part], messages)
        .replace(/\{(\w+)\}/g, (_, name) => String(values[name])),
    }) };
    if (id === '@hugeicons/react') return { HugeiconsIcon: () => null };
    if (id === '@hugeicons/core-free-icons') return {};
    return require(id);
  } });
  return exports;
}

test('settings round trip resumes the exact pending OAuth interaction', () => {
  const uid = 'pending-connection_42';
  const settings = new URL(mcpEnrollmentLinks(uid).settings, 'https://oren.finance');
  const returnLink = mcpEnrollmentLinks(settings.searchParams.get('connection')).connection;
  assert.equal(settings.pathname, '/app/settings/connections');
  assert.equal(returnLink, `/connect/mcp?uid=${uid}`);
  assert.equal(new URL(returnLink, settings).origin, settings.origin);
});

test('return targets cannot become external redirects or accept ambiguous parameters', () => {
  for (const uid of [undefined, '', ['a', 'b'], 'https://evil.example', '//evil.example', '../other', 'a?uid=b', 'a#fragment', 'a'.repeat(201)]) {
    assert.deepEqual(mcpEnrollmentLinks(uid), { settings: '/app/settings/connections', connection: undefined });
  }
});

test('active permission offers a continuation link, or instructions without a pending interaction', () => {
  const { ConnectionNextStep } = loadComponent('../app/settings/mcp/connection-next-step.tsx');
  const pending = renderToStaticMarkup(createElement(ConnectionNextStep, { uid: 'pending_42' }));
  assert.match(pending, /href="\/connect\/mcp\?uid=pending_42"/);
  assert.match(pending, /Continue connection/);
  const standalone = renderToStaticMarkup(createElement(ConnectionNextStep));
  assert.match(standalone, /Return to Claude, Cursor or Codex/);
  assert.doesNotMatch(standalone, /href=/);
});

test('the form discloses both sides without a permission selector and respects server availability', () => {
  const { TradeGrantEditor } = loadComponent('../app/settings/mcp/trade-grant-editor.tsx');
  for (const sellAvailable of [true, false]) {
    const spendLimits = { maxPerTradeUsd: 100000, maxDailyUsd: 999999999.99 };
    const html = renderToStaticMarkup(createElement(TradeGrantEditor, { sellAvailable, spendLimits, maxDurationHours: 0, untilRevoked: true, busy: false, signerConfigured: true, onReview() {} }));
    assert.doesNotMatch(html, /Trading permission|Choose which trades/);
    assert.match(html, sellAvailable ? /allow my agent to buy and sell within them/ : /allow my agent to buy within them/);
    assert.match(html, /disabled=""/); // Consent is required before review.
    assert.match(html, /Until revoked/);
    assert.doesNotMatch(html, /<select/);
    assert.match(html, /max="100000"/);
    assert.match(html, /max="999999999.99"/);
    assert.match(html, /Up to \$100,000 each trade/);
  }
});


test('legacy settings redirects and the app page preserve only a valid pending interaction', async () => {
  const redirects = [];
  const { default: LegacyPage } = loadComponent('../app/settings/mcp/page.tsx', {
    'next/navigation': { redirect: destination => { redirects.push(destination); } },
  });
  const { default: AppPage } = loadComponent('../app/app/settings/connections/page.tsx', {
    '@/components/shell': { AppShell: () => null },
    '@/components/settings/agent-connections': { AgentConnections: () => null },
  });
  for (const connection of ['pending_42', undefined, ['a', 'b'], '//evil.example']) {
    const searchParams = Promise.resolve({ connection });
    await LegacyPage({ searchParams });
    assert.equal(redirects.at(-1), mcpEnrollmentLinks(connection).settings);
    const page = await AppPage({ searchParams });
    assert.equal(page.props.children.props.connectionUid, connection === 'pending_42' ? connection : undefined);
  }
});
