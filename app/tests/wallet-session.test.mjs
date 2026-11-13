import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { create } from 'zustand';
import { invalidateWalletSession, sessionSetter, walletSessionIsCurrent } from '../services/wallet-session.ts';
import { resolveSolanaWallet } from '../services/wallet-selection.ts';

test('only Solana wallets linked to the session are selectable', () => {
  const user = { id: 'user', linkedAccounts: [
    { type: 'wallet', chainType: 'solana', address: 'owned' },
    { type: 'wallet', chainType: 'ethereum', address: 'other-chain' },
  ] };
  const result = resolveSolanaWallet([{ address: 'stranger' }, { address: 'other-chain' }, { address: 'owned' }], user);
  assert.deepEqual(result.linked.map((wallet) => wallet.address), ['owned']);
  assert.equal(result.active.address, 'owned');
  assert.equal(resolveSolanaWallet([{ address: 'owned' }], null).active, undefined);
});

test('restoring a disconnected selected wallet does not silently switch accounts', () => {
  const user = { id: 'user', linkedAccounts: ['embedded', 'external'].map((address) => ({ type: 'wallet', chainType: 'solana', address })) };
  const selection = { userId: 'user', address: 'external' };
  const result = resolveSolanaWallet([{ address: 'embedded' }], user, selection);
  assert.equal(result.active, undefined);
  assert.equal(resolveSolanaWallet([{ address: 'embedded' }, { address: 'external' }], user, selection).active.address, 'external');
  assert.equal(resolveSolanaWallet([{ address: 'embedded' }], user, { userId: 'previous-user', address: 'external' }).active.address, 'embedded');
});

const require = createRequire(import.meta.url);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Run the actual stores with deferred service calls, exercising response races.
function loadStore(name, services) {
  const source = readFileSync(new URL(`../store/${name}-store.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, AbortController, crypto: globalThis.crypto,
    require(id) {
      if (id === 'zustand') return { create };
      if (id === '@/services') return services;
      if (id === '@/services/wallet-session') return { sessionSetter, walletSessionIsCurrent };
      if (id === './wallet-store') return { useWalletStore: { getState: () => ({}) } };
      return require(id);
    },
  });
  return Object.values(exports)[0];
}

test('old portfolio response cannot overwrite the next wallet', async () => {
  const old = deferred();
  const store = loadStore('portfolio', { getPortfolio: (wallet) => wallet === 'old' ? old.promise : Promise.resolve({ wallet: 'new' }) });
  const pending = store.getState().loadPortfolio('old');
  invalidateWalletSession();
  store.getState().reset();
  await store.getState().loadPortfolio('new');
  old.resolve({ wallet: 'old' });
  await pending;
  assert.equal(store.getState().portfolio.wallet, 'new');
  assert.equal(store.getState().wallet, 'new');
});

test('late portfolio failure cannot replace the next wallet state', async () => {
  const old = deferred();
  const store = loadStore('portfolio', { getPortfolio: () => old.promise });
  const pending = store.getState().loadPortfolio('old');
  invalidateWalletSession();
  store.getState().reset();
  old.reject(new Error('previous account failed'));
  await pending;
  assert.equal(store.getState().error, undefined);
  assert.equal(store.getState().portfolio, undefined);
});

test('prepared trade from a signed-out session stays cleared', async () => {
  const old = deferred();
  const store = loadStore('execution', { prepareExecution: () => old.promise });
  const pending = store.getState().prepareTrade({ wallet: 'old', quoteId: 'quote' });
  invalidateWalletSession();
  store.getState().resetAll();
  old.resolve({ transaction: 'old-transaction' });
  await pending;
  assert.equal(store.getState().prepared, undefined);
  assert.equal(store.getState().isLoading, false);
});

test('late agent events and history cannot populate the next account', async () => {
  const history = deferred();
  let onEvent;
  const stream = deferred();
  const store = loadStore('agent', {
    getAgentThreadMessages: () => history.promise,
    streamAgentMessage: (_request, callback) => { onEvent = callback; return stream.promise; },
  });
  await store.getState().initialize('old');
  const loading = store.getState().loadThread('old-thread');
  const sending = store.getState().sendMessage('hello', 'old');
  invalidateWalletSession();
  await store.getState().initialize('new');
  onEvent({ type: 'turn_started', threadId: 'old-thread', message: { id: 'old' } });
  history.resolve({ messages: [{ id: 'old-message' }] });
  stream.resolve();
  await Promise.all([loading, sending]);
  assert.equal(store.getState().walletAddress, 'new');
  assert.equal(store.getState().threadId, undefined);
  assert.equal(store.getState().messages.length, 0);
  assert.equal(store.getState().recentThreads.length, 0);
  assert.equal(store.getState().lastRequest, undefined);
});
