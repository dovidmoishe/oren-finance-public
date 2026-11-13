import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import {
  ownerPermissionMessage,
  verifyOwnerProof,
  type OwnerMessage,
} from './grant-owner-proof';

function proofFixture() {
  const keys = generateKeyPairSync('ed25519');
  const wallet = new PublicKey(
    keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
  ).toBase58();
  const now = Date.now();
  const value: OwnerMessage = {
    version: 1,
    appId: 'app',
    action: 'prepare',
    nonce: randomUUID(),
    issuedAt: now,
    validUntil: now + 300000,
    userId: 'owner',
    walletId: 'wallet',
    wallet,
    delegationId: randomUUID(),
    signerId: null,
    policyId: null,
    terms: {
      perTradeUsd: '0.100000',
      dailyUsd: '0.200000',
      allowSell: false,
      maxSlippageBps: 50,
      expiresAt: new Date(now + 3600000).toISOString(),
    },
  };
  const message = ownerPermissionMessage(value);
  const proof = {
    message,
    signature: sign(null, Buffer.from(message), keys.privateKey).toString(
      'base64',
    ),
  };
  return { keys, value, proof };
}

describe('exact wallet-owner grant proofs', () => {
  it('verifies an owner-signed bounded permission without any Privy bearer', () => {
    const f = proofFixture();
    expect(verifyOwnerProof(f.proof, 'app', 'prepare')).toEqual(f.value);
  });
  it.each(['amount', 'expiry', 'delegation', 'action', 'wallet', 'app'])(
    'rejects altered %s with the original signature',
    (field) => {
      const f = proofFixture();
      if (field === 'amount') f.value.terms!.dailyUsd = '50.000000';
      if (field === 'expiry')
        f.value.terms!.expiresAt = new Date(
          Date.now() + 86400000,
        ).toISOString();
      if (field === 'delegation') f.value.delegationId = randomUUID();
      if (field === 'action') f.value.action = 'activate';
      if (field === 'wallet')
        f.value.wallet = new PublicKey(Buffer.alloc(32, 7)).toBase58();
      if (field === 'app') f.value.appId = 'another-app';
      f.proof.message = ownerPermissionMessage(f.value);
      expect(() => verifyOwnerProof(f.proof, 'app', 'prepare')).toThrow();
    },
  );
  it('rejects expired or cross-action proofs even when signed by the owner', () => {
    const f = proofFixture();
    f.value.issuedAt = Date.now() - 600000;
    f.value.validUntil = Date.now() - 300000;
    f.proof.message = ownerPermissionMessage(f.value);
    f.proof.signature = sign(
      null,
      Buffer.from(f.proof.message),
      f.keys.privateKey,
    ).toString('base64');
    expect(() => verifyOwnerProof(f.proof, 'app', 'prepare')).toThrow(
      'expired',
    );
    expect(() =>
      verifyOwnerProof(proofFixture().proof, 'app', 'activate'),
    ).toThrow();
  });
});
