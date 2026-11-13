import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { englishI18n } from './support/i18n-english.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function fixture() {
  const slots = []; let cursor = 0, revision = 0;
  const effects = [];
  let token = async () => 'jwt';
  let authorize = async () => 'owner-signature';
  const row = { id: 'withdrawal', wallet: 'wallet', kind: 'withdrawal', status: 'prepared', feeLamports: '5000', expiresAt: new Date(Date.now() + 60000).toISOString(), details: { asset: 'USDC', amount: '1.25', recipient: 'recipient', rentLamports: '2039280' } };
  let pending = [];
  let stocks = [];
  let preparedInput;
  let recoveryError;
  let submit = async () => ({ ...row, status: 'submitted' });
  let requests = 0, submissions = 0, authorizations = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; const previous = slots[i]; if (!previous || deps.some((v, index) => v !== previous.deps[index])) { previous?.cleanup?.(); const entry = { deps }; slots[i] = entry; effects.push(() => { entry.cleanup = fn(); }); } },
  };
  const auth = { getAccessToken: () => token(), authorizeTrade: (...args) => { authorizations++; return authorize(...args); } };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  let code = readFileSync(new URL('../components/portfolio/withdrawal-modal.tsx', import.meta.url), 'utf8').replace('function WithdrawalForm(', 'export function WithdrawalForm(');
  code = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, {
    exports, Error, Date, crypto: { randomUUID: () => 'request-id' },
    window: { setInterval: () => 1, clearInterval() {} }, setTimeout: () => 1, clearTimeout() {},
    require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (id === '@hugeicons/core-free-icons') return {};
      if (id === '@hugeicons/react') return {};
      if (id === '@/components/auth/auth-context') return { useOrenAuth: () => auth };
      if (id === '@/components/ui') return { Button: 'button' };
    if (id === '@/i18n/i18n') return englishI18n;
      if (id === '@/components/stock/stock-logo-assets') return { stockLogos: { TSLA: '/landing/tesla.svg' } };
      if (id === '@/hooks/use-funding') return { useFunding: () => ({ snapshot: { usdc: '5', sol: '0.1' } }) };
      if (id === '@/hooks/use-portfolio-refresh') return { usePortfolioRefresh: () => async () => {} };
      if (id === '@/services/api-client') return { ApiError: class ApiError extends Error {} };
      if (id === '@/services/environment') return { financialExecutionEnabled: true };
      if (id === '@/services/wallet-session') return { walletSessionIsCurrent: () => { const captured = revision; return () => captured === revision; } };
      if (id === '@/services/withdrawal-service') return { recoverWithdrawal: async () => { if (recoveryError) throw recoveryError; return pending[0]; }, getWithdrawalStocks: async () => ({ stocks, incomplete: false }), solCost: value => String(Number(value) / 1e9), prepareWithdrawal: async input => { requests++; preparedInput = input; assert.equal(input.requestId, 'request-id'); return row; } };
      if (id === '@/services/approval-service') return {
        getPendingServerApprovals: async () => pending,
        approveServerTrade: (...args) => { submissions++; assert.deepEqual(args, args.length === 3 ? ['withdrawal', 'jwt', 'wallet'] : ['withdrawal', 'jwt', 'wallet', 'owner-signature']); return submit(); },
        getServerApproval: async () => ({ ...row, status: row.status === 'signed' ? 'signed' : 'submitted' }), forgetApproval() {},
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  function render() { cursor = 0; const tree = exports.WithdrawalForm({ wallet: 'wallet' }); while (effects.length) effects.shift()(); return tree; }
  function nodes(tree, type) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, type));
    return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
  }
  const button = (text) => nodes(render(), 'button').find(node => node.props.children === text);
  async function review(asset) {
    render(); await tick();
    if (asset) nodes(render(), 'select')[0].props.onChange({ target: { value: asset } });
    nodes(render(), 'input').find(node => node.props.placeholder === 'Solana wallet address').props.onChange({ target: { value: 'recipient' } });
    nodes(render(), 'input').find(node => node.props.placeholder === '0.00').props.onChange({ target: { value: '1.25' } });
    nodes(render(), 'form')[0].props.onSubmit({ preventDefault() {} }); await tick();
  }
  function check() { nodes(render(), 'input').find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); }
  return { render, nodes, button, review, check, row,
    counts: () => ({ requests, submissions, authorizations }),
    stocks: items => { stocks = items; }, preparedInput: () => preparedInput,
    recoveryError: error => { recoveryError = error; },
    pending: rows => { pending = rows; }, submit: fn => { submit = fn; }, authorize: fn => { authorize = fn; }, token: fn => { token = fn; }, changeSession: () => { revision++; },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}

test('withdrawal review requires an explicit checked confirmation and never signs during preparation', async () => {
  const f = fixture(); await f.review();
  assert.deepEqual(f.counts(), { requests: 1, submissions: 0, authorizations: 0 });
  assert.equal(f.button('Confirm transfer').props.disabled, true);
  f.check(); assert.equal(f.button('Confirm transfer').props.disabled, false);
  f.button('Confirm transfer').props.onClick(); await tick();
  assert.deepEqual(f.counts(), { requests: 1, submissions: 1, authorizations: 1 });
  assert.ok(f.button('Check transfer status'));
});

test('stock withdrawal selects the exact held variant and shows its identity in review', async () => {
  const f = fixture();
  f.stocks([
    { mint: 'mint-xstocks', ticker: 'TSLA', symbol: 'TSLAx', name: 'Tesla xStock', issuer: 'xStocks', balance: '2.5', decimals: 8 },
    { mint: 'mint-other', ticker: 'TSLA', symbol: 'TSLA', name: 'Tesla', issuer: 'Other issuer', balance: '1.5', decimals: 6 },
  ]);
  f.row.details = { ...f.row.details, asset: 'STOCK', mint: 'mint-xstocks', symbol: 'TSLAx', issuer: 'xStocks', name: 'Tesla xStock' };
  await f.review('mint-xstocks');
  assert.equal(f.preparedInput().asset, 'STOCK');
  assert.equal(f.preparedInput().mint, 'mint-xstocks');
  const review = JSON.stringify(f.render());
  assert.ok(review.includes('Tesla xStock'));
  assert.ok(review.includes('mint-xstocks'));
  assert.ok(review.includes('xStocks'));
  assert.equal(f.counts().authorizations, 0);
});

test('a lost withdrawal response stays pending and status checks cannot create another transfer', async () => {
  const f = fixture(); f.submit(async () => { throw new Error('Network timeout'); });
  await f.review(); f.check();
  const confirm = f.button('Confirm transfer'); confirm.props.onClick(); confirm.props.onClick(); await tick();
  assert.equal(f.counts().submissions, 1);
  assert.equal(f.button('Confirm transfer'), undefined);
  f.button('Check transfer status').props.onClick(); await tick();
  assert.equal(f.counts().submissions, 1);
  assert.equal(f.counts().requests, 1);
});

test('reopening the modal recovers pending withdrawals instead of offering a new send', async () => {
  const f = fixture(); f.pending([{ ...f.row, status: 'signed' }]); f.render(); await tick();
  assert.ok(f.button('Check transfer status'));
  assert.equal(f.nodes(f.render(), 'form').length, 0);
  assert.deepEqual(f.counts(), { requests: 0, submissions: 0, authorizations: 0 });
});

test('an uncertain prepared withdrawal cannot reopen a fresh send form', async () => {
  const f = fixture(); f.pending([{ ...f.row, status: 'prepared' }]); f.render(); await tick();
  assert.ok(f.button('Check transfer status'));
  assert.equal(f.nodes(f.render(), 'form').length, 0);
  assert.ok(JSON.stringify(f.render()).includes('approval may still be processing'));
});

test('failed recovery blocks another withdrawal until a retry verifies the previous state', async () => {
  const f = fixture(); f.recoveryError(new Error('Unavailable')); f.render(); await tick();
  assert.equal(f.nodes(f.render(), 'form').length, 0);
  assert.ok(f.button('Check pending transfers'));
  f.recoveryError(undefined); f.button('Check pending transfers').props.onClick(); f.render(); await tick();
  assert.equal(f.nodes(f.render(), 'form').length, 1);
});

test('wallet changes while authorizing a withdrawal prevent submission', async () => {
  const f = fixture(), wait = deferred(); f.authorize(() => wait.promise);
  await f.review(); f.check(); f.button('Confirm transfer').props.onClick(); await tick();
  f.changeSession(); wait.resolve('old-owner-signature'); await tick();
  assert.equal(f.counts().submissions, 0);
});

test('recovery retries the existing signed withdrawal without preparing or authorizing another one', async () => {
  const f = fixture(); f.row.status = 'signed'; f.pending([f.row]); f.render(); await tick();
  f.button('Retry same submission').props.onClick(); await tick();
  assert.deepEqual(f.counts(), { requests: 0, submissions: 1, authorizations: 0 });
});

test('closing the modal while authorizing prevents a later submission', async () => {
  const f = fixture(), wait = deferred(); f.authorize(() => wait.promise);
  await f.review(); f.check(); f.button('Confirm transfer').props.onClick(); await tick();
  f.unmount(); wait.resolve('owner-signature'); await tick();
  assert.equal(f.counts().submissions, 0);
});

test('an expired withdrawal cannot request authorization', async () => {
  const f = fixture(); await f.review(); f.check(); f.row.expiresAt = new Date(0).toISOString();
  f.button('Confirm transfer').props.onClick(); await tick();
  assert.equal(f.counts().authorizations, 0);
  assert.equal(f.counts().submissions, 0);
});
