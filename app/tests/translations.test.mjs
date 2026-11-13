import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('every language matches the English keys, placeholders and plural forms', () => {
  const script = fileURLToPath(new URL('../scripts/validate-translations.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  assert.match(output, /Translations match English/);
});
