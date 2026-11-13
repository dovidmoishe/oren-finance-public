import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { invalidateWalletSession, walletSessionIsCurrent } from '../services/wallet-session.ts';

const require = createRequire(import.meta.url);
const exports = {};
vm.runInNewContext(ts.transpileModule(
  readFileSync(new URL('../services/privy-signer.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, {
  exports,
  require(id) { return id === './wallet-session' ? { walletSessionIsCurrent } : require(id); },
});
const { createPrivySigner } = exports;

for (const version of ['legacy', 'v0']) {
  test(`Privy compatibility preserves and signs an offline ${version} transaction`, async () => {
    const key = Keypair.generate();
    const wallet = { address: key.publicKey.toBase58() };
    const instructions = [SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })];
    const blockhash = Keypair.generate().publicKey.toBase58();
    const transaction = version === 'legacy'
      ? new Transaction({ feePayer: key.publicKey, recentBlockhash: blockhash }).add(...instructions)
      : new VersionedTransaction(new TransactionMessage({ payerKey: key.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message());
    let submitted;
    const signer = createPrivySigner({
      wallet, getAddress: () => wallet.address,
      async signTransaction(input) {
        assert.equal(input.wallet, wallet);
        const decoded = version === 'legacy' ? Transaction.from(input.transaction) : VersionedTransaction.deserialize(input.transaction);
        if (version === 'legacy') decoded.partialSign(key);
        else decoded.sign([key]);
        return { signedTransaction: decoded.serialize() };
      },
      async signMessage() { throw new Error('unexpected message signature'); },
    });
    const signature = await signer.sendTransaction(transaction, {
      async sendRawTransaction(bytes) { submitted = bytes; return 'offline-signature'; },
    });
    assert.equal(signature, 'offline-signature');
    if (version === 'legacy') assert.equal(Transaction.from(submitted).verifySignatures(), true);
    else assert.ok(VersionedTransaction.deserialize(submitted).signatures[0].some((byte) => byte !== 0));
  });
}

test('wallet change during a signature prevents broadcast', async () => {
  const key = Keypair.generate();
  let broadcasts = 0;
  const signer = createPrivySigner({
    wallet: { address: key.publicKey.toBase58() }, getAddress: () => key.publicKey.toBase58(),
    async signTransaction({ transaction }) { invalidateWalletSession(); return { signedTransaction: transaction }; },
    async signMessage() {},
  });
  const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: key.publicKey, recentBlockhash: key.publicKey.toBase58(), instructions: [] }).compileToV0Message());
  await assert.rejects(signer.sendTransaction(transaction, {
    async sendRawTransaction() { broadcasts++; },
  }), /wallet changed/);
  assert.equal(broadcasts, 0);
});

test('stale wallet callback cannot request another signature', async () => {
  let signatures = 0;
  const signer = createPrivySigner({
    wallet: { address: 'old' }, getAddress: () => 'new',
    async signTransaction() { signatures++; },
    async signMessage() { signatures++; },
  });
  await assert.rejects(signer.signMessage(new Uint8Array([1])), /wallet changed/);
  assert.equal(signatures, 0);
});
