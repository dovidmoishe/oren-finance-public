import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { Children, isValidElement } from 'react';

function load(file) {
  const filename = file.startsWith('/') ? file : fileURLToPath(new URL(file, import.meta.url));
  const localRequire = createRequire(filename);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id) {
    if (id === '@hugeicons/core-free-icons') return {};
    if (id === '@hugeicons/react') return { HugeiconsIcon: () => null };
    if (id === '@/components/stock/stock-logo') return { StockLogo: () => null };
    if (id === '@/components/ui') return { Button: 'button', Toast: () => null, formatCurrency: (value) => `$${value.toFixed(2)}`, formatNumber: String };
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filename), id);
      const candidate = ['.ts', '.tsx', '.js', ''].map((ext) => `${resolved}${ext}`).find((item) => existsSync(item));
      if (candidate?.endsWith('.ts') || candidate?.endsWith('.tsx')) return load(candidate);
    }
    return localRequire(id);
  } });
  return exports;
}
function find(node, predicate) {
  if (!isValidElement(node)) return;
  if (predicate(node)) return node;
  for (const child of Children.toArray(node.props.children)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
const { AgentComposerView } = load('../components/agent/agent-composer-view.tsx');
const { BasketProposal } = load('../components/trading/basket-proposal.tsx');
const composerProps = { connected: true, isSending: false, composer: '', composerRef: { current: null }, placeholder: 'Ask Oren', onComposerChange() {}, onSubmit() {}, onStop() {} };

test('shared composer preserves disabled, sending and keyboard behavior', () => {
  assert.equal(find(AgentComposerView(composerProps), (node) => node.props['aria-label'] === 'Send message').props.disabled, true);
  assert.equal(find(AgentComposerView({ ...composerProps, composer: 'Hello', connected: false }), (node) => node.type === 'textarea').props.disabled, true);
  assert.ok(find(AgentComposerView({ ...composerProps, isSending: true }), (node) => node.props['aria-label'] === 'Stop response'));
  let sent = 0;
  let prevented = 0;
  const tree = AgentComposerView({ ...composerProps, composer: 'Add Tesla', onSubmit() { sent++; } });
  const textarea = find(tree, (node) => node.type === 'textarea');
  textarea.props.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(sent, 0);
  textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() { prevented++; } });
  assert.equal(sent, 1);
  assert.equal(prevented, 1);
});

test('shared basket proposal forwards the original proposal to the review callback', () => {
  const basket = { id: 'test', totalAmountUsd: 100.01, allocations: [{ assetId: 'nvda', ticker: 'NVDA', amountUsd: 100.01, weightPercent: 100 }] };
  let reviewed;
  const tree = BasketProposal({ basket, onReview(value) { reviewed = value; } });
  find(tree, (node) => node.type === 'button').props.onClick();
  assert.equal(reviewed, basket);
  assert.equal(find(tree, (node) => node.props.children === '$100.01').props.children, '$100.01');
});
