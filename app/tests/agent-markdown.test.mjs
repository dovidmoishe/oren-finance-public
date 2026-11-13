import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, URL },
  );
  return exports;
}

const { parseAgentMessage, linkTextForUrl } = load('../components/agent/agent-markdown.ts');

test('renders short names as links and parks numbers behind details', () => {
  const blocks = parseAgentMessage(
    [
      'Mostly bullish: 30 of 39 writers are positive on Tesla.',
      '',
      '- [BowTied Bull](https://x.com/BowTiedBull/status/1) is adding.',
      '- [@TheLongInvest](https://x.com/TheLongInvest/status/2) is cautious.',
      '',
      ':::details',
      'RSI14: 60.27',
      ':::',
      '',
      'Not financial advice. Opinions are not facts.',
      '',
      'Want me to:',
      '1. Summarize the quotes',
      '2. Compare the writers',
      '3. Draft a limit order',
    ].join('\n'),
  );

  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[0].lines[0][0].text, 'Mostly bullish: 30 of 39 writers are positive on Tesla.');
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[1].items[0][0].type, 'link');
  assert.equal(blocks[1].items[0][0].label, 'BowTied Bull');
  assert.equal(blocks[1].items[0][0].href, 'https://x.com/BowTiedBull/status/1');
  assert.equal(blocks[1].items[1][0].label, '@TheLongInvest');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[2].type, 'details');
  assert.match(blocks[2].text, /RSI14/);
  assert.doesNotMatch(JSON.stringify(blocks), /not financial advice/i);
  assert.doesNotMatch(JSON.stringify(blocks), /Summarize the quotes/);
});

test('does not render an empty details toggle', () => {
  for (const sample of [
    'Hello\n\n:::details\n:::\n',
    'Hello\n\n:::details\n\n:::\n',
    'Hello\n\n:::details\n\u200b\n:::\n',
    "Hello\n\n:::details\n(the tool's details, unchanged)\n:::\n",
  ]) {
    const blocks = parseAgentMessage(sample);
    assert.equal(blocks.some((block) => block.type === 'details'), false, sample);
    assert.equal(blocks[0].lines[0][0].text, 'Hello');
  }

  const shown = parseAgentMessage('Hello\n\n:::details\nPositive 31, negative 9.\n:::');
  assert.equal(shown.at(-1).type, 'details');
  assert.match(shown.at(-1).text, /negative 9/);

  const padded = parseAgentMessage(
    ['Hello', '', ':::details', '', '', 'Sources: X post 28.', '', '', ':::'].join('\n'),
  );
  assert.equal(padded.at(-1).type, 'details');
  assert.equal(padded.at(-1).text, 'Sources: X post 28.');
  assert.doesNotMatch(padded.at(-1).text, /\n\n/);
});

test('linkifies a raw X url as the handle and ignores unsafe schemes', () => {
  assert.equal(linkTextForUrl('https://x.com/TheLongInvest/status/2'), '@TheLongInvest');
  const blocks = parseAgentMessage('See https://x.com/BowTiedBull/status/9 and [bad](javascript:alert(1)).');
  assert.equal(blocks[0].lines[0][1].type, 'link');
  assert.equal(blocks[0].lines[0][1].label, '@BowTiedBull');
  assert.equal(blocks[0].lines[0].at(-1).type, 'text');
});
