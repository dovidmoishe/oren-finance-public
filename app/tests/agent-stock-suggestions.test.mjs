import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

test('stock-page suggestion asks for sourced public opinion on the selected stock', () => {
  const exports = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../components/agent/agent-utils.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(code, { exports, require });
  const suggestions = exports.promptSuggestions({ page: 'stock', assetId: 'nvda' }, 'NVDA');
  assert.ok(suggestions.includes('What are people saying about NVDA?'));
  assert.equal(suggestions.length, 4);
});
