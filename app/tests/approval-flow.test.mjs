import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

function fixture() {
  const slots = []; let cursor = 0, revision = 0, approvals = 0;
  let token = async () => 'jwt';
  let authorize = async () => 'request-signature';
  let submit = async () => ({ wallet: 'wallet', referenceId: 'quote', executionId: 'execution', status: 'submitted', signature: 'signature' });
  const timers = [];
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { return fn; },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../hooks/use-quote-execution.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, window: { setTimeout: fn => { timers.push(fn); } }, require(id) {
    if (id === 'react') return react;
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ address: 'wallet', getAccessToken: () => token(), authorizeTrade: (...args) => authorize(...args) }) };
    if (id === '@/services/wallet-session') return { walletSessionIsCurrent: () => { const captured = revision; return () => revision === captured; } };
    if (id === '@/services/api-client') return { ApiError };
    if (id === '@/services/approval-service') return { approveServerTrade: (...args) => { approvals++; return submit(...args); }, getServerApproval: async () => ({ status: 'confirmed' }), forgetApproval() {} };
    if (id === './use-portfolio-refresh') return { usePortfolioRefresh: () => async () => {} };
    throw new Error(`Unexpected import ${id}`);
  } });
  const render = () => { cursor = 0; return exports.useQuoteExecution(); };
  return { render, changeSession() { revision++; }, setToken(fn) { token = fn; }, setAuthorize(fn) { authorize = fn; }, setSubmit(fn) { submit = fn; }, count: () => approvals, timers };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('explicit confirmation submits only the reviewed approval and suppresses double-clicks', async () => {
  const f = fixture(), pending = deferred(); let args;
  f.setSubmit((...values) => { args = values; return pending.promise; });
  const hook = f.render();
  assert.equal(f.count(), 0);
  const first = hook.executeQuote({ id: 'quote' }, 'approval-id');
  await new Promise(resolve => setImmediate(resolve));
  await hook.executeQuote({ id: 'quote' }, 'approval-id');
  assert.equal(f.count(), 1);
  assert.deepEqual(args, ['approval-id', 'jwt', 'wallet', 'request-signature']);
  pending.resolve({ wallet: 'wallet', referenceId: 'quote', executionId: 'execution', signature: 'signature', status: 'submitted' });
  await first;
  assert.equal(f.render().flowStatus, 'submitted');
});
test('sign-out while retrieving the access token prevents approval', async () => {
  const f = fixture(), pending = deferred(); f.setToken(() => pending.promise);
  const action = f.render().executeQuote({ id: 'quote' }, 'approval-id');
  f.changeSession(); pending.resolve('old-jwt'); await action;
  assert.equal(f.count(), 0);
});
test('a lost submission response remains pending and never triggers an automatic retry', async () => {
  const f = fixture(); f.setSubmit(async () => { throw new Error('network timeout'); });
  await f.render().executeQuote({ id: 'quote' }, 'approval-id');
  assert.equal(f.render().flowStatus, 'submitted');
  assert.match(f.render().error, /uncertain/);
  assert.equal(f.count(), 1);
});
test('a definite Privy signing failure surfaces the server error instead of reporting an uncertain submission', async () => {
  const f = fixture();
  f.setSubmit(async () => { throw new ApiError('Privy could not authorize this trade. No transaction was submitted.', 503, { code: 'PRIVY_SIGNING_FAILED', submissionState: 'not_submitted' }); });
  await f.render().executeQuote({ id: 'quote' }, 'approval-id');
  assert.equal(f.render().flowStatus, 'failed');
  assert.match(f.render().error, /No transaction was submitted/);
  assert.equal(f.count(), 1);
});
test('an unclassified server outage remains uncertain and does not repeat submission', async () => {
  const f = fixture();
  f.setSubmit(async () => { throw new ApiError('Service unavailable', 503); });
  await f.render().executeQuote({ id: 'quote' }, 'approval-id');
  assert.equal(f.render().flowStatus, 'submitted');
  assert.match(f.render().error, /uncertain/);
  assert.equal(f.count(), 1);
});
test('a late response cannot populate the next wallet session', async () => {
  const f = fixture(), pending = deferred(); f.setSubmit(() => pending.promise);
  const action = f.render().executeQuote({ id: 'quote' }, 'approval-id');
  await new Promise(resolve => setImmediate(resolve)); f.changeSession();
  pending.resolve({ wallet: 'wallet', referenceId: 'quote', signature: 'old', status: 'submitted' });
  await action;
  assert.equal(f.render().confirmation, undefined);
});
test('account changes during request authorization prevent submission', async () => {
  const f = fixture(), pending = deferred();
  f.setAuthorize(() => pending.promise);
  const action = f.render().executeQuote({ id: 'quote' }, 'approval-id');
  await new Promise(resolve => setImmediate(resolve));
  f.changeSession(); pending.resolve('previous-account-authorization'); await action;
  assert.equal(f.count(), 0);
});
test('a refused request authorization is a definite failure without posting an approval', async () => {
  const f = fixture();
  f.setAuthorize(async () => { throw new Error('Authorization cancelled'); });
  await f.render().executeQuote({ id: 'quote' }, 'approval-id');
  assert.equal(f.count(), 0);
  assert.equal(f.render().flowStatus, 'failed');
  assert.equal(f.render().error, 'Authorization cancelled');
});
