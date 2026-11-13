import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chunkFiles, listDefaultLintFiles } from '../scripts/lint-bounded.mjs';

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('bounded lint chunks are a partition of the default eslint file set', async () => {
  const files = await listDefaultLintFiles(appRoot);
  assert.ok(files.length > 10);
  assert.ok(files.some(file => file.endsWith('tests/lint-bounded.test.mjs')));
  assert.ok(files.every(file => !file.includes(`${path.sep}node_modules${path.sep}`)));
  assert.ok(files.every(file => !file.includes(`${path.sep}.next${path.sep}`)));
  const chunks = chunkFiles(files);
  assert.deepEqual(chunks.flat(), files);
  assert.ok(chunks.every(chunk => chunk.length <= 12));
  const source = readFileSync(new URL('../scripts/lint-bounded.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /--quiet|--max-warnings|--fix/);
  assert.doesNotMatch(source, /require\.resolve\('eslint\/bin\/eslint\.js'\)/);
  const require = createRequire(import.meta.url);
  const manifest = require.resolve('eslint/package.json');
  const bin = path.join(path.dirname(manifest), require(manifest).bin.eslint);
  assert.equal(existsSync(bin), true);
});
