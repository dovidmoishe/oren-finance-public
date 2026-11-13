import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadRules() {
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../components/feedback/feedback-rules.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}

test('feedback form asks for a subject and message before sending', () => {
  const { feedbackError } = loadRules();
  assert.equal(feedbackError('  ', 'Hello'), 'Add a short subject.');
  assert.equal(feedbackError('Hi', '   '), 'Tell us a bit more in the message.');
  assert.match(feedbackError('x'.repeat(121), 'Hello'), /under 120/);
  assert.match(feedbackError('Hi', 'x'.repeat(4001)), /under 4000/);
  assert.equal(feedbackError('Chart is blank', 'NVDA chart shows nothing'), undefined);
});

test('ticket reference is a short readable code', () => {
  const { ticketReference } = loadRules();
  assert.equal(ticketReference('3f0c8a3e-5b8e-4c1a-9a2e-1d2c3b4a5f60'), '#3F0C8A3E');
});
