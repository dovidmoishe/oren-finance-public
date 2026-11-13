import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../components/landing/stock-mix-model.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { initialMix, setMixWeight, toggleMixStock, equalMix, mixAmounts, applyMixRequest } = exports;

function valid(holdings) {
  assert.ok(holdings.length >= 1 && holdings.length <= 4);
  assert.equal(new Set(holdings.map((holding) => holding.symbol)).size, holdings.length);
  assert.equal(holdings.reduce((total, holding) => total + holding.weight, 0), 100);
  assert.ok(holdings.every((holding) => Number.isInteger(holding.weight) && holding.weight >= 0 && holding.weight <= 100));
}

test('slider preserves the chosen percentage and exactly redistributes the rest', () => {
  for (let percent = 0; percent <= 100; percent++) {
    const mix = setMixWeight(initialMix, 'NVDA', percent);
    valid(mix);
    assert.equal(mix.find((holding) => holding.symbol === 'NVDA').weight, percent);
  }
  const concentrated = setMixWeight(initialMix, 'NVDA', 100);
  const restored = setMixWeight(concentrated, 'NVDA', 40);
  valid(restored);
  assert.equal(restored[1].weight, 30);
  assert.equal(restored[2].weight, 30);
});

test('adding, removing and equalizing stocks keeps a nonempty mix at 100 percent', () => {
  let mix = initialMix;
  for (let index = 0; index < 100; index++) {
    const symbol = ['NVDA', 'AAPL', 'MSFT', 'TSLA'][index % 4];
    mix = toggleMixStock(mix, symbol);
    valid(mix);
    mix = setMixWeight(mix, mix[0].symbol, (index * 17) % 101);
    valid(mix);
    valid(equalMix(mix));
  }
  const only = [{ symbol: 'AAPL', weight: 100 }];
  assert.equal(toggleMixStock(only, 'AAPL'), only);
  assert.equal(setMixWeight(only, 'AAPL', 30)[0].weight, 100);
  assert.equal(initialMix[0].weight, 40, 'interactions never mutate reset values');
});

test('displayed amounts add to the selected budget in whole cents', () => {
  for (const budget of [100, 500, 1000, 100.01]) {
    const mix = equalMix(initialMix);
    const amounts = mixAmounts(mix, budget);
    assert.equal(amounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0), Math.round(budget * 100));
  }
});

test('demo requests are local, bounded and keep the allocation valid', () => {
  const added = applyMixRequest(initialMix, 1000, 'Add Tesla');
  valid(added.holdings);
  assert.equal(added.holdings.length, 4);
  assert.equal(applyMixRequest(added.holdings, 1000, 'Add Tesla').holdings.length, 4);
  const result = applyMixRequest(added.holdings, 1000, 'Make it equal and use $500');
  assert.equal(result.budget, 500);
  assert.ok(result.holdings.every((holding) => holding.weight === 25));
  assert.equal(applyMixRequest(initialMix, 1000, 'Use $999999').budget, 1000);
  assert.equal(applyMixRequest(initialMix, 1000, 'Buy everything').recognized, false);
  const reduced = applyMixRequest(initialMix, 1000, 'Less NVIDIA');
  assert.equal(reduced.holdings[0].weight, 30);
  valid(reduced.holdings);
});
