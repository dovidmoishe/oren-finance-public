import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PrivyClient } from '@privy-io/node';
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
test('the real Privy SDK forwards the exact client-authorized request without exchanging a login JWT', async () => {
  const requests = [];
  const authExports = loadSource(new URL('../src/auth/privy-wallet-auth.ts', import.meta.url), {
    '@privy-io/node': { PrivyClient: class { constructor(options) { return new PrivyClient({ ...options, maxRetries: 0, fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
      return new Response(JSON.stringify({ method: 'signTransaction', data: { signed_transaction: 'signed-offline' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    } }); } } },
  });
  const auth = new authExports.PrivyWalletAuth('offline-app', 'offline-secret');
  const expiry = new Date(Date.now() + 60000);
  const payload = auth.signingRequest('wallet-id', 'unsigned-offline', 'approval-id', expiry);
  assert.equal(await auth.signTransaction('wallet-id', 'offline-authorization', 'unsigned-offline', 'approval-id', expiry), 'signed-offline');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, payload.url);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.body)), requests[0].body);
  for (const [key, value] of Object.entries(payload.headers)) assert.equal(requests[0].headers.get(key), value);
  assert.equal(requests[0].headers.get('privy-authorization-signature'), 'offline-authorization');
});
// Resolve relative TypeScript dependencies beside their source, rather than
// beside this script. Exercise the real balance guard with the real SDK too.
function loadSource(url, modules = {}) {
  const exports = {};
  const sourceRequire = createRequire(url);
  vm.runInNewContext(ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true },
  }).outputText, { exports, Buffer, process, require(id) {
    if (id in modules) return modules[id];
    if (id === '../alchemy/alchemy.client') return { AlchemyClient: class {} };
    return id.startsWith('.') ? loadSource(new URL(`${id}.ts`, url), modules) : sourceRequire(id);
  } });
  return exports;
}
const exports = loadSource(new URL('../src/execution/approval-rpc.service.ts', import.meta.url));
const rpc = new exports.ApprovalRpc({ call() { throw new Error('No network calls allowed'); } });
test('simulation and fee estimation start together while simulation failures still reject the trade', async () => {
  const owner = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  let resolveSimulation;
  const simulation = new Promise(resolve => { resolveSimulation = resolve; });
  const methods = [];
  const service = new exports.ApprovalRpc({ call(method) {
    methods.push(method);
    if (method === 'simulateTransaction') return simulation;
    if (method === 'getFeeForMessage') return Promise.resolve({ value: 5000 });
    throw new Error('No other RPC calls allowed');
  } });
  const inspecting = service.inspect(bytes, owner.publicKey.toBase58());
  assert.deepEqual(methods, ['simulateTransaction', 'getFeeForMessage']);
  resolveSimulation({ value: { err: { InstructionError: [0, 'failure'] } } });
  await assert.rejects(inspecting, /could not be simulated/);
});
test('does not treat a recent blockhash absent from the finalized bank as expired', async () => {
  const owner = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  let finalizedHeight = 100;
  const calls = [];
  const service = new exports.ApprovalRpc({ async call(method) { calls.push(method); return method === 'getBlockHeight' ? finalizedHeight : { value: false }; } });
  assert.equal(await service.blockhashValid(bytes, owner.publicKey.toBase58()), true);
  assert.equal(await service.blockhashValid(bytes, owner.publicKey.toBase58(), 150), true);
  assert.deepEqual(calls, ['getBlockHeight']);
  finalizedHeight = 151;
  assert.equal(await service.blockhashValid(bytes, owner.publicKey.toBase58(), 150), false);
  assert.deepEqual(calls, ['getBlockHeight', 'getBlockHeight', 'isBlockhashValid']);
});
for (const version of ['legacy', 'v0']) {
  test(`validates real offline ${version} transaction bytes, fee payer and signatures`, () => {
    const owner = Keypair.generate(), other = Keypair.generate();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const instructions = [SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: other.publicKey, lamports: 1 })];
    const tx = version === 'legacy'
      ? new Transaction({ feePayer: owner.publicKey, recentBlockhash: blockhash }).add(...instructions)
      : new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
    const unsigned = Buffer.from(version === 'legacy' ? tx.serialize({ requireAllSignatures: false, verifySignatures: false }) : tx.serialize()).toString('base64');
    if (version === 'legacy') tx.partialSign(owner); else tx.sign([owner]);
    const signed = Buffer.from(tx.serialize()).toString('base64');
    assert.equal(typeof rpc.validateSigned(unsigned, signed, owner.publicKey.toBase58()), 'string');
    assert.throws(() => rpc.validateSigned(unsigned, signed, other.publicKey.toBase58()), /does not belong/);
    assert.throws(() => rpc.validateSigned(unsigned, unsigned, owner.publicKey.toBase58()), /signature could not/);
    const changed = VersionedTransaction.deserialize(Buffer.from(signed, 'base64'));
    changed.message.recentBlockhash = other.publicKey.toBase58();
    changed.sign([owner]);
    assert.throws(() => rpc.validateSigned(unsigned, Buffer.from(changed.serialize()).toString('base64'), owner.publicKey.toBase58()), /does not match/);
  });
}
