import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { englishI18n } from './support/i18n-english.mjs';

async function checkNotice(kind, status) {
  const slots = [[{ id: 'approval', wallet: 'wallet' }], undefined, undefined, false, []];
  let cursor = 0;
  const forgotten = [];
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../components/trading/pending-approval-notice.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require(id) {
    if (id === 'react') return { useEffect() {}, useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } };
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === '@/components/ui') return { Button: 'button' };
    if (id === '@/i18n/i18n') return englishI18n;
    if (id === '@/components/auth/auth-context') return { useOrenAuth: () => ({ address: 'wallet', getAccessToken: async () => 'jwt' }) };
    if (id === '@/services/wallet-session') return { walletSessionIsCurrent: () => () => true };
    if (id === '@/hooks/use-portfolio-refresh') return { usePortfolioRefresh: () => async () => {} };
    if (id === '@/services/approval-service') return { getServerApproval: async () => ({ id: 'approval', kind, status }), forgetApproval: id => forgotten.push(id) };
    throw new Error(`Unexpected import ${id}`);
  } });
  function render() { cursor = 0; return exports.PendingApprovalNotice(); }
  const tree = render();
  const button = tree.props.children.find(child => child?.type === 'button');
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  return { forgotten, text: JSON.stringify(render()) };
}

test('checking an uncertain prepared withdrawal does not erase its recovery ID', async () => {
  const result = await checkNotice('withdrawal', 'prepared');
  assert.deepEqual(result.forgotten, []);
  assert.match(result.text, /approval may still be processing/);
});

test('a safely expired withdrawal clears its recovery ID', async () => {
  assert.deepEqual((await checkNotice('withdrawal', 'failed')).forgotten, ['approval']);
});

test('an unprocessed trade review retains its existing recovery behavior', async () => {
  assert.deepEqual((await checkNotice('swap', 'prepared')).forgotten, ['approval']);
});
