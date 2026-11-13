import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

function load(file, modules = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Number, Error, require(id) {
    if (id in modules) return modules[id];
    if (id === '@/services/route-label') return load('../services/route-label.ts');
    return require(id);
  } });
  return exports;
}

const future = () => new Date(Date.now() + 30_000).toISOString();
const details = (alternative = {}) => ({
  quoteId: 'titan-quote',
  reviewed: { provider: 'titan:Titan-DART', outputAmount: 4.02, minimumOutputAmount: 3.9999, minOutRaw: '399990000', slippageBps: 50, outputSymbol: 'TSLAx' },
  latest: { provider: 'titan:Titan-DART', outputAmount: 3.98, minimumOutputAmount: 3.9601, minOutRaw: '396010000', slippageBps: 50, outputSymbol: 'TSLAx' },
  alternative: { id: 'jup-alt', provider: 'jupiter', outputAmount: 3.99, minimumOutputAmount: 3.97005, minOutRaw: '397005000', slippageBps: 50, outputSymbol: 'TSLAx', expiresAt: future(), ...alternative },
});
const priceMovedError = body => new ApiError('The price moved', 409, { statusCode: 409, error: 'PRICE_MOVED', priceMoved: body });

const priceMoved = load('../services/price-moved.ts');

test('recognises PRICE_MOVED errors and keeps a valid alternative', () => {
  const parsed = priceMoved.priceMovedFrom(priceMovedError(details()));
  assert.equal(parsed.alternative.id, 'jup-alt');
  assert.equal(priceMoved.priceMovedFrom(new ApiError('nope', 409, { error: 'CONFLICT' })), undefined);
  assert.equal(priceMoved.priceMovedFrom(new ApiError('bad', 400, { error: 'PRICE_MOVED', priceMoved: details() })), undefined);
  assert.equal(priceMoved.priceMovedFrom(new Error('network')), undefined);
});

test('drops an expired alternative instead of offering it', () => {
  const parsed = priceMoved.priceMovedFrom(priceMovedError(details({ expiresAt: new Date(Date.now() - 1).toISOString() })));
  assert.equal(parsed.quoteId, 'titan-quote');
  assert.equal(parsed.alternative, undefined);
});

test('computes the output change versus the reviewed quote', () => {
  assert.ok(Math.abs(priceMoved.priceMovedChangePercent(details()) - ((3.99 - 4.02) / 4.02) * 100) < 1e-9);
});

function loadReview() {
  const buttons = [];
  const ui = {
    Button: props => { buttons.push(props); return createElement('button', { 'data-variant': props.variant, disabled: props.disabled }, props.children); },
    Toast: ({ title, description }) => createElement('div', { role: 'status' }, `${title}: ${description}`),
    formatNumber: (value, _locale, digits) => Number(value).toFixed(digits),
  };
  const { PriceMovedReview } = load('../components/trading/price-moved-review.tsx', {
    '@/components/ui': ui,
    '@/services/price-moved': priceMoved,
    '@/services/environment': { financialExecutionEnabled: true },
    '@hugeicons/core-free-icons': {},
    '@hugeicons/react': { HugeiconsIcon: () => null },
  });
  return { PriceMovedReview, buttons };
}

test('shows old vs new terms and the Jupiter alternative with accept and cancel', () => {
  const { PriceMovedReview, buttons } = loadReview();
  const accepted = []; let cancelled = 0;
  const html = renderToStaticMarkup(createElement(PriceMovedReview, {
    details: details(), onAccept: q => accepted.push(q), onCancel: () => { cancelled++; },
  }));
  for (const text of ['You reviewed', 'Best route now', 'Jupiter alternative', '3.999900 TSLAx', '3.970050 TSLAx', 'Titan', 'Jupiter', 'Nothing was signed', '0.75% less']) {
    assert.ok(html.includes(text), `missing ${text}`);
  }
  const accept = buttons.find(b => b.variant === 'primary');
  const cancel = buttons.find(b => b.variant === 'secondary');
  accept.onClick(); cancel.onClick();
  assert.deepEqual(accepted.map(q => q.id), ['jup-alt']);
  assert.equal(cancelled, 1);
});

test('without an alternative only cancel is offered', () => {
  const { PriceMovedReview, buttons } = loadReview();
  const html = renderToStaticMarkup(createElement(PriceMovedReview, {
    details: { ...details(), alternative: undefined }, onAccept() { throw new Error('no'); }, onCancel() {},
  }));
  assert.ok(html.includes('No alternative route'));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].variant, 'secondary');
});

function approvalReviewFixture(prepareImpl, executionEnabled = true) {
  const slots = []; let cursor = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect() {},
  };
  const { useApprovalReview: reviewHook } = load('../hooks/use-approval-review.ts', {
    react,
    '@/services/environment': { financialExecutionEnabled: executionEnabled },
    '@/components/auth/auth-context': { useOrenAuth: () => ({ address: 'wallet', getAccessToken: async () => 'jwt' }) },
    '@/services/approval-service': { prepareServerApproval: prepareImpl },
    '@/services/price-moved': priceMoved,
  });
  return { render: id => { cursor = 0; return reviewHook('swap', id, true); } };
}

test('approval review surfaces PRICE_MOVED instead of a retryable error', async () => {
  const f = approvalReviewFixture(async () => { throw priceMovedError(details()); });
  await f.render('titan-quote').prepare();
  const state = f.render('titan-quote');
  assert.equal(state.error, undefined);
  assert.equal(state.approval, undefined);
  assert.equal(state.priceMoved.alternative.id, 'jup-alt');
  // A different reviewed quote (e.g. the accepted alternative) clears it.
  assert.equal(f.render('jup-alt').priceMoved, undefined);
});

test('other prepare failures stay ordinary errors', async () => {
  const f = approvalReviewFixture(async () => { throw new ApiError('Simulation failed', 400, { error: 'Bad Request' }); });
  await f.render('q').prepare();
  const state = f.render('q');
  assert.equal(state.error, 'Simulation failed');
  assert.equal(state.priceMoved, undefined);
});

function executionFixture() {
  const sent = [];
  let address;
  const services = load('../services/execution-service.ts', {
    './api-client': { apiRequest: async (_path, options) => { sent.push(options.body); return { id: 'q' }; } },
  });
  let state;
  const zustand = { create: init => { const set = p => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; }; state = init(set, () => state); const hook = sel => sel(state); hook.getState = () => state; return hook; } };
  const { useExecutionStore } = load('../store/execution-store.ts', {
    zustand,
    '@/services/wallet-session': { sessionSetter: set => set },
    './wallet-store': { useWalletStore: { getState: () => ({ address }) } },
    '@/services': services,
  });
  return { useExecutionStore, sent, setWallet: value => { address = value; } };
}

test('automatic quote refreshes are flagged for the background lane; manual retries are not', async () => {
  const { useExecutionStore, sent } = executionFixture();
  const store = useExecutionStore.getState();
  await store.quoteTrade({ side: 'buy', ticker: 'TSLA', amountUsd: 10 });
  await useExecutionStore.getState().refreshQuote();
  await useExecutionStore.getState().refreshQuote({ manual: true });
  assert.equal(sent[0].autoRefresh, undefined);
  assert.equal(sent[1].autoRefresh, true);
  assert.equal(sent[2].autoRefresh, undefined);
});

test('agent quote refreshes include the session wallet on both lanes', async () => {
  const { useExecutionStore, sent, setWallet } = executionFixture();
  setWallet('session-wallet');
  useExecutionStore.getState().seedQuote({
    id: 'agent-titan', assetId: 'tsla', ticker: 'TSLA', side: 'buy',
    amountUsd: 100, inputAmount: 100, slippageBps: 50, variant: { mint: 'stock' },
  });
  assert.equal(useExecutionStore.getState().lastQuoteIntent.wallet, 'session-wallet');
  await useExecutionStore.getState().refreshQuote();
  await useExecutionStore.getState().refreshQuote({ manual: true });
  assert.equal(sent.length, 2);
  assert.ok(sent.every(intent => intent.wallet === 'session-wallet'));
  assert.equal(sent[0].autoRefresh, true);
  assert.equal(sent[1].autoRefresh, undefined);
});

test('refresh resolves the current wallet even if the artifact was seeded before it was ready', async () => {
  const { useExecutionStore, sent, setWallet } = executionFixture();
  useExecutionStore.getState().seedQuote({
    id: 'agent-sell', assetId: 'tsla', ticker: 'TSLA', side: 'sell',
    inputAmount: 2, slippageBps: 50, variant: { mint: 'stock' },
  });
  setWallet('ready-wallet');
  await useExecutionStore.getState().refreshQuote();
  assert.equal(sent[0].wallet, 'ready-wallet');
  assert.equal(sent[0].amount, 2);
  assert.equal(sent[0].preferredMint, 'stock');
});

test('preview approval reviews never request preparation', async () => {
  let calls = 0;
  const f = approvalReviewFixture(async () => { calls++; }, false);
  await f.render('preview-quote').prepare();
  assert.equal(calls, 0);
});
