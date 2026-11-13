import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  let local = [], remote = [], rows = {};
  let error;
  const forgotten = [];
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../services/withdrawal-service.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Error, require(id) {
    if (id === './api-client') return {};
    if (id === './approval-service') return {
      pendingApprovals: () => local,
      getPendingServerApprovals: async () => { if (error) throw error; return remote; },
      getServerApproval: async id => { if (!rows[id]) throw new Error('Status unavailable'); return rows[id]; },
      forgetApproval: id => forgotten.push(id),
    };
    throw new Error(`Unexpected import ${id}`);
  } });
  return { recover: () => exports.recoverWithdrawal('wallet', 'jwt'), local: entries => { local = entries; }, remote: entries => { remote = entries; }, rows: entries => { rows = entries; }, error: value => { error = value; }, forgotten };
}
const approval = status => ({ id: 'withdrawal', wallet: 'wallet', kind: 'withdrawal', status });

test('recovery reads the local ID when a lost approve request is still prepared on the server', async () => {
  const f = fixture(); f.local([{ id: 'withdrawal', wallet: 'wallet' }]); f.rows({ withdrawal: approval('prepared') });
  assert.equal((await f.recover()).status, 'prepared');
  assert.deepEqual(f.forgotten, []);
});

test('a definitively expired or failed local approval is cleared so the user can send again', async () => {
  const f = fixture(); f.local([{ id: 'withdrawal', wallet: 'wallet' }]); f.rows({ withdrawal: approval('failed') });
  assert.equal(await f.recover(), undefined);
  assert.deepEqual(f.forgotten, ['withdrawal']);
});

test('a failed local status read cannot be mistaken for permission to create another withdrawal', async () => {
  const f = fixture(); f.local([{ id: 'withdrawal', wallet: 'wallet' }]);
  await assert.rejects(f.recover(), /Status unavailable/);
});

test('server-only pending withdrawals remain recoverable without browser storage', async () => {
  const f = fixture(); f.remote([approval('signed')]);
  assert.equal((await f.recover()).status, 'signed');
});

test('other wallets cannot affect withdrawal recovery', async () => {
  const f = fixture(); f.local([{ id: 'other', wallet: 'another-wallet' }]); f.remote([{ ...approval('submitted'), wallet: 'another-wallet' }]);
  assert.equal(await f.recover(), undefined);
});
