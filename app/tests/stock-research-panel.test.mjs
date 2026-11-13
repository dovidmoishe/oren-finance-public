import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);

test('stock research renders distinct evidence, sources, saved thesis and changes', () => {
  const report = {
    assetId: 'nvda', ticker: 'NVDA', name: 'NVIDIA',
    analysis: { available: true, observedAt: '2026-11-02', data: { summary: 'Range bound.', opportunityScore: 64 } },
    news: { available: true, data: [{ id: 'news-1', headline: 'Chip demand rises', url: 'https://example.com/news', publishedAt: '2026-11-01' }] },
    portfolio: { available: true, data: { allocationPercent: 12 } },
    opinions: { available: true, observedAt: '2026-11-02', data: { items: [{ author: 'Alice', source: 'Daily Tape', date: '2026-11-01', url: 'https://example.com/view', stance: 'BULLISH', action: 'ADD', summary: 'Demand is strong.' }], window: { from: '2026-10-01', to: '2026-11-01' }, mentionCount: 2, distinctAuthors: 1, coverage: 'thin', disagreement: false } },
    saved: { note: 'Watch valuation.', snapshot: { capturedAt: '2026-11-01', opinionCitations: [{ author: 'Alice', source: 'Daily Tape', date: '2026-11-01', url: 'https://example.com/view' }], newsCitations: [] } },
    changes: [{ kind: 'score', text: 'Oren Score rose 5 points.' }],
  };
  let state = 0;
  const values = [report, 'owned', false, undefined];
  const react = { useState() { return [values[state++], () => {}]; }, useRef: () => ({ current: 0 }), useEffect() {}, useCallback: (fn) => fn };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/stock/stock-research.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require(id) {
    if (id === 'react') return react;
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ address: 'owned', getAccessToken: async () => 'token' }) };
    if (id === '@/services/research-service') return {};
    return require(id);
  } });
  const html = renderToStaticMarkup(require('react').createElement(exports.StockResearchPanel, { assetId: 'nvda' }));
  for (const label of ['Oren read', 'Recent cited news', 'Chip demand rises', 'Covered', 'Writer views', 'Where they disagree']) assert.ok(html.includes(label), label);
  for (const hidden of ['Your view', 'Save view', 'What changed', 'View saved sources', 'Watch valuation.']) {
    assert.equal(html.includes(hidden), false, hidden);
  }
  assert.ok(html.includes('https://example.com/view'));
  assert.ok(html.includes('lg:grid-cols-2'));
  assert.ok(html.includes('lg:col-span-2'));
  assert.equal(html.includes('Company filings'), false);
});

test('stock research renders cited company filings without treating them as the score', () => {
  const report = {
    assetId: 'apple',
    ticker: 'AAPL',
    name: 'Apple',
    analysis: { available: true, observedAt: '2026-11-02', data: { summary: 'Range bound.', opportunityScore: 64 } },
    news: { available: false },
    portfolio: { available: true, data: null },
    opinions: { available: false, reason: 'not_enabled' },
    company: {
      available: true,
      reason: 'stale',
      publishedAt: '2026-11-03',
      fetchedAt: '2026-11-08T14:00:00.000Z',
      data: {
        briefing: ['Derived FY2026 Q4 revenue is $114,477,000,000, from full-year minus Q1, Q2 and Q3.', 'Filing facts, not the Oren Score, not a recommendation.'],
        links: [{ label: 'bad', url: 'https://evil.example/buy' }],
        latestQuarter: {
          fiscalYear: 2026,
          fiscalQuarter: 4,
          start: '2026-06-28',
          end: '2026-09-26',
          derived: true,
          revenue: {
            available: true,
            display: '$114,477,000,000',
            derived: true,
            inputCitations: [{
              form: '10-K',
              filed: '2026-11-03',
              periodEnd: '2026-09-26',
              sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html',
            }],
          },
          netIncome: { available: true, display: '$28,000,000,000', citation: { form: '10-K', filed: '2026-11-03', periodEnd: '2026-09-26', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html' } },
          operatingMargin: { available: true, display: '32%' },
          revenueGrowth: { available: true, display: '15.06%' },
        },
        ttm: { start: '2025-09-28', end: '2026-09-26', revenue: { available: true, display: '$478,834,000,000' } },
        latestAnnual: { fiscalYear: 2026, start: '2025-09-28', end: '2026-09-26', revenue: { available: true, display: '$478,834,000,000' } },
        filings: [
          {
            form: '10-Q',
            filed: '2026-07-31',
            reportDate: '2026-06-27',
            accession: '0000320193-26-000020',
            sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/0000320193-26-000020-index.html',
          },
          {
            form: '10-K',
            filed: '2026-11-03',
            reportDate: '2026-09-26',
            accession: '0000320193-26-000026',
            sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html',
          },
        ],
      },
    },
  };
  let state = 0;
  const values = [report, 'owned', false, undefined];
  const react = { useState() { return [values[state++], () => {}]; }, useRef: () => ({ current: 0 }), useEffect() {}, useCallback: (fn) => fn };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/stock/stock-research.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require(id) {
    if (id === 'react') return react;
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ address: 'owned', getAccessToken: async () => 'token' }) };
    if (id === '@/services/research-service') return {};
    return require(id);
  } });
  const html = renderToStaticMarkup(require('react').createElement(exports.StockResearchPanel, { assetId: 'apple' }));
  assert.ok(html.includes('Company filings'));
  assert.ok(html.includes('$114,477,000,000'));
  assert.ok(html.includes('$478,834,000,000'));
  assert.ok(html.includes('Latest quarter'));
  assert.ok(html.includes('Trailing twelve months'));
  assert.ok(html.includes('Full year'));
  assert.ok(html.includes('View on SEC'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('10-K'));
  assert.ok(html.includes('10-Q'));
  assert.equal(html.split('not a recommendation').length - 1, 1);
  assert.equal(html.includes('(https://www.sec.gov/'), false);
  assert.ok(html.includes('https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html'));
  assert.equal(html.includes('https://evil.example/buy'), false);
  assert.ok(html.includes('Deterministic Oren Score'));
  const sourceList = html.slice(html.indexOf('Source filings'));
  assert.ok(sourceList.indexOf('10-K') < sourceList.indexOf('10-Q'));
});

test('company filing fallback renders SEC markdown links and drops other urls', () => {
  const secUrl = 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.html';
  const report = {
    assetId: 'apple',
    ticker: 'AAPL',
    name: 'Apple',
    analysis: { available: false },
    news: { available: false },
    portfolio: { available: false },
    opinions: { available: false },
    company: {
      available: false,
      reason: 'provider_unavailable',
      data: {
        briefing: [
          `Quarterly revenue is unavailable (not_comparable), [10-K filed 2026-02-20](${secUrl}) [ignore](https://evil.example/buy).`,
          'Filing facts, not the Oren Score, not a recommendation.',
        ],
        links: [],
        filings: [],
      },
    },
  };
  let state = 0;
  const values = [report, 'owned', false, undefined];
  const react = { useState() { return [values[state++], () => {}]; }, useRef: () => ({ current: 0 }), useEffect() {}, useCallback: (fn) => fn };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/stock/stock-research.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require(id) {
    if (id === 'react') return react;
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ address: 'owned', getAccessToken: async () => 'token' }) };
    if (id === '@/services/research-service') return {};
    return require(id);
  } });
  const html = renderToStaticMarkup(require('react').createElement(exports.StockResearchPanel, { assetId: 'apple' }));
  assert.ok(html.includes(`href="${secUrl}"`));
  assert.ok(html.includes('10-K filed 2026-02-20'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.equal(html.includes('(https://www.sec.gov/'), false);
  assert.equal(html.includes('https://evil.example/buy'), false);
  assert.equal(html.split('not a recommendation').length - 1, 1);
});
