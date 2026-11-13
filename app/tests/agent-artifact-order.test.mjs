import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function loadLocal(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, require(id) {
    if (id === './agent-markdown') return loadLocal('../components/agent/agent-markdown.ts');
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    return require(id);
  } });
  return exports;
}
function loadComponent(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, require(id) {
    if (id === './agent-artifacts') return { AgentArtifacts: () => createElement('div', { 'data-artifacts': true }, 'Analysis card') };
    if (id === './agent-conversation') return {};
    if (id === './agent-composer-view') return {};
    if (id === './agent-utils') return { toolLabel: () => 'Running Oren analysis' };
    if (id === './agent-message-body') return loadLocal('../components/agent/agent-message-body.tsx');
    if (id === './agent-markdown') return loadLocal('../components/agent/agent-markdown.ts');
    if (id === '@/components/ui') return { cn: (...values) => values.filter(Boolean).join(' ') };
    if (id === '@/components/auth/auth-context') return {};
    if (id === '@hugeicons/core-free-icons') return {};
    if (id === '@hugeicons/react') return { HugeiconsIcon: () => null };
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    return require(id);
  } });
  return exports;
}

const { AgentMessage } = loadComponent('../components/agent/agent-conversation.tsx');
const { latestAssistantArtifacts } = loadComponent('../components/agent/agent-workspace.tsx');
const artifacts = [{ type: 'analysis', data: { ticker: 'SPCX' } }];
const base = { id: 'assistant-1', role: 'assistant', content: '', artifacts };
const markup = (message) => renderToStaticMarkup(createElement(AgentMessage, { message }));

test('tool results stay hidden before and during text streaming in chat and workspace', () => {
  for (const content of ['', 'SPCX is range-bound']) {
    const message = { ...base, content, streaming: true };
    const html = markup(message);
    assert.doesNotMatch(html, /data-artifacts/);
    assert.equal(latestAssistantArtifacts([message]).length, 0);
    assert.match(html, content ? /SPCX is range-bound/ : /Oren is thinking/);
  }
});

test('completed and restored responses show artifacts after the answer text', () => {
  for (const streaming of [false, undefined]) {
    const message = { ...base, content: 'SPCX is range-bound.', streaming };
    const html = markup(message);
    assert.ok(html.indexOf(message.content) < html.indexOf('data-artifacts'));
    assert.match(html, /data-artifacts/);
    assert.equal(latestAssistantArtifacts([message]), artifacts);
  }
});

test('stopped or failed responses do not suddenly reveal buffered cards', () => {
  const message = { ...base, content: 'Partial answer', streaming: false, interrupted: true };
  assert.doesNotMatch(markup(message), /data-artifacts/);
  assert.match(markup(message), /Stopped before completion/);
  assert.equal(latestAssistantArtifacts([message]).length, 0);
});

test('workspace keeps the previous completed working set while the next response streams', () => {
  const previous = { ...base, content: 'Previous answer' };
  const pending = { ...base, id: 'assistant-2', streaming: true, artifacts: [{ type: 'stock', data: {} }] };
  assert.equal(latestAssistantArtifacts([previous, pending]), artifacts);
  assert.equal(latestAssistantArtifacts([previous, { ...pending, streaming: false }]), pending.artifacts);
});
