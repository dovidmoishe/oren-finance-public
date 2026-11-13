import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function load(file, modules = {}) {
  const filename = fileURLToPath(new URL(file, import.meta.url));
  const localRequire = createRequire(filename);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(id) {
      if (id in modules) return modules[id];
      if (id.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), id);
        const candidate = ['.ts', '.tsx', '.js', ''].map((ext) => `${resolved}${ext}`).find((item) => existsSync(item));
        if (candidate?.endsWith('.ts') || candidate?.endsWith('.tsx')) return load(pathToFileUrl(candidate), modules);
      }
      return localRequire(id);
    },
  });
  return exports;
}

function pathToFileUrl(filename) {
  return new URL(`file://${filename}`).href;
}

const routeLabel = load('../services/route-label.ts');

test('names Titan and Jupiter without guessing', () => {
  assert.equal(routeLabel.routeVenueLabel('titan:Titan-DART'), 'Titan');
  assert.equal(routeLabel.routeVenueLabel('jupiter'), 'Jupiter');
  assert.equal(routeLabel.routeVenueLabel('jupiter-trigger'), 'Jupiter');
  assert.equal(routeLabel.routeVenueLabel('jupiter-fallback'), 'Jupiter');
  assert.equal(routeLabel.routeVenueLabel(null), undefined);
  assert.equal(routeLabel.routeVenueLabel(''), undefined);
  assert.equal(routeLabel.routeVenueLabel('oren-vault'), undefined);
  assert.equal(routeLabel.formatQuotedRoute('titan:Titan', 'TSLAx'), 'Titan · TSLAx');
  assert.equal(routeLabel.formatQuotedRoute('custom-amm', 'TSLAx'), 'Selected route · TSLAx');
  assert.equal(routeLabel.formatQuotedRoute('titan:Titan', 'TSLAx').includes('titan:'), false);
});

const portfolio = load('../services/portfolio-service.ts', {
  './api-client': { apiRequest() { throw new Error('unused'); } },
});

test('activity keeps a recorded route and omits a missing one', () => {
  const titan = portfolio.mapActivityItem({
    source: 'oren',
    id: '1',
    type: 'stock_purchase',
    ticker: 'TSLA',
    provider: 'titan:Titan-DART',
    status: 'confirmed',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  const limit = portfolio.mapActivityItem({
    source: 'oren',
    id: '2',
    type: 'limit_buy',
    ticker: 'AAPL',
    provider: 'jupiter-trigger',
    status: 'confirmed',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  const legacy = portfolio.mapActivityItem({
    source: 'oren',
    id: '3',
    type: 'stock_sale',
    ticker: 'NVDA',
    provider: null,
    status: 'confirmed',
    createdAt: '2026-11-01T00:00:00.000Z',
  });
  const wallet = portfolio.mapActivityItem({
    source: 'wallet',
    signature: 'sig',
    status: 'confirmed',
  });
  assert.equal(titan.route, 'Titan');
  assert.equal(titan.type, 'trade');
  assert.equal(limit.route, 'Jupiter');
  assert.equal(limit.type, 'trade');
  assert.equal(legacy.route, undefined);
  assert.equal(wallet.route, undefined);
  assert.equal(JSON.stringify(legacy).includes('Jupiter'), false);
  assert.equal(JSON.stringify(legacy).includes('Titan'), false);
});

function ui() {
  return {
    Button: (props) => createElement('button', { disabled: props.disabled }, props.children),
    Modal: ({ title, children }) => createElement('section', null, createElement('h2', null, title), children),
    Toast: ({ title, description }) => createElement('div', null, `${title}: ${description}`),
    EmptyState: ({ title, description }) => createElement('p', null, `${title}. ${description}`),
    formatCurrency: (value) => `$${Number(value).toFixed(2)}`,
    formatNumber: (value, _locale, digits = 2) => Number(value).toFixed(digits),
    formatDateTime: (value) => String(value ?? ""),
    formatRelativeTime: () => 'just now',
  };
}

const icons = {
  '@hugeicons/core-free-icons': {},
  '@hugeicons/react': { HugeiconsIcon: () => null },
};

function quote(provider) {
  return {
    id: 'quote-1',
    assetId: 'tsla',
    ticker: 'TSLA',
    side: 'buy',
    variant: { mint: 'mint', symbol: 'TSLAx', name: 'Tesla', tradable: true },
    inputMint: 'usdc',
    outputMint: 'mint',
    inputSymbol: 'USDC',
    outputSymbol: 'TSLAx',
    inputAmount: 25,
    outputAmount: 0.1,
    estimatedPriceUsd: 250,
    amountUsd: 25,
    priceImpactPercent: 0.1,
    slippageBps: 50,
    provider,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    quotedAt: new Date().toISOString(),
  };
}

test('receipt shows the prepared route, not the raw provider id', () => {
  const reviewed = quote('jupiter');
  const prepared = quote('titan:Titan-DART');
  const { QuoteReviewModal } = load('../components/trading/quote-review-modal.tsx', {
    ...icons,
    '@/services/environment': { financialExecutionEnabled: true },
    '@/services/route-label': routeLabel,
    '@/components/ui': ui(),
    '@/hooks/use-approval-review': {
      useApprovalReview: () => ({
        approval: {
          id: 'approval-1',
          status: 'prepared',
          referenceId: reviewed.id,
          wallet: 'wallet',
          feeLamports: '5000',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          details: { quote: prepared },
        },
        loading: false,
        expired: false,
        secondsLeft: 40,
        prepare() {},
      }),
    },
    './price-moved-review': { PriceMovedReview: () => null },
  });
  const html = renderToStaticMarkup(createElement(QuoteReviewModal, {
    open: true,
    quote: reviewed,
    status: 'confirmed',
    confirmation: {
      executionId: 'exec-1',
      quoteId: reviewed.id,
      wallet: 'wallet',
      signature: 'signature-1',
      status: 'submitted',
      trackingStatus: 'pending',
    },
    onClose() {},
    onSign: async () => {},
  }));
  assert.equal(html.includes('Routed through Titan'), true);
  assert.equal(html.includes('>Titan<'), true);
  assert.equal(html.includes('titan:'), false);
  assert.equal(html.includes('jupiter'), false);
});

test('receipt stays quiet when no route was recorded', () => {
  const blank = quote('');
  const { QuoteReviewModal } = load('../components/trading/quote-review-modal.tsx', {
    ...icons,
    '@/services/environment': { financialExecutionEnabled: true },
    '@/services/route-label': routeLabel,
    '@/components/ui': ui(),
    '@/hooks/use-approval-review': {
      useApprovalReview: () => ({ loading: false, expired: false, secondsLeft: 0, prepare() {} }),
    },
    './price-moved-review': { PriceMovedReview: () => null },
  });
  const html = renderToStaticMarkup(createElement(QuoteReviewModal, {
    open: true,
    quote: blank,
    status: 'confirmed',
    confirmation: {
      executionId: 'exec-2',
      quoteId: blank.id,
      wallet: 'wallet',
      signature: 'signature-2',
      status: 'submitted',
      trackingStatus: 'pending',
    },
    onClose() {},
    onSign: async () => {},
  }));
  assert.equal(html.includes('Routed through'), false);
  assert.equal(html.includes('Titan'), false);
  assert.equal(html.includes('Jupiter'), false);
});

test('limit order receipt names Jupiter', () => {
  const proposal = {
    id: 'proposal-1',
    side: 'buy',
    assetId: 'aapl',
    ticker: 'AAPL',
    variant: { mint: 'mint', symbol: 'AAPLx', name: 'Apple', tradable: true },
    inputMint: 'usdc',
    outputMint: 'mint',
    inputSymbol: 'USDC',
    outputSymbol: 'AAPLx',
    makingAmount: 20,
    takingAmount: 0.08,
    makingAmountRaw: '20000000',
    takingAmountRaw: '80000',
    limitPriceUsd: 250,
    amountUsd: 20,
    wouldFillImmediately: false,
    expiredAt: 1_900_000_000,
    slippageBps: 0,
    provider: 'jupiter-trigger',
    createdAt: new Date().toISOString(),
  };
  const { LimitOrderReviewModal } = load('../components/trading/limit-order-review-modal.tsx', {
    ...icons,
    '@/services/environment': { financialExecutionEnabled: true },
    '@/services/route-label': routeLabel,
    '@/components/ui': ui(),
    '@/hooks/use-approval-review': {
      useApprovalReview: () => ({
        approval: {
          id: 'approval-2',
          status: 'prepared',
          referenceId: proposal.id,
          feeLamports: '5000',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          details: { proposal },
        },
        loading: false,
        expired: false,
        secondsLeft: 30,
        prepare() {},
      }),
    },
  });
  const html = renderToStaticMarkup(createElement(LimitOrderReviewModal, {
    open: true,
    proposal,
    status: 'confirmed',
    confirmation: { signature: 'sig-limit', orderKey: 'order-1' },
    onClose() {},
    onSign: async () => {},
  }));
  assert.equal(html.includes('Routed through Jupiter'), true);
  assert.equal(html.includes('jupiter-trigger'), false);
});

test('activity history prints a route only when one was stored', () => {
  const { ActivityList } = load('../components/portfolio/activity-list.tsx', {
    '@/components/ui': ui(),
  });
  const html = renderToStaticMarkup(createElement(ActivityList, {
    items: [
      { id: '1', type: 'trade', ticker: 'TSLA', route: 'Titan', valueUsd: 25, occurredAt: '2026-11-01T00:00:00.000Z' },
      { id: '2', type: 'trade', ticker: 'NVDA', valueUsd: 10, occurredAt: '2026-11-01T00:00:00.000Z' },
    ],
  }));
  assert.equal(html.includes('TSLA'), true);
  assert.equal(html.includes('Titan'), true);
  assert.equal(html.includes('NVDA'), true);
  assert.equal(html.includes('Jupiter'), false);
});
