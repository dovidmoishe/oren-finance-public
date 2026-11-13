// Needs the real PublicKey (PDA derivation) and VersionedTransaction.
jest.mock(
  'rpc-websockets',
  () => ({ CommonClient: class {}, WebSocket: class {} }),
  { virtual: true },
);
jest.mock('@solana/web3.js', () =>
  jest.requireActual<Record<string, unknown>>(
    '@solana/web3.js/lib/index.cjs.js',
  ),
);

import { BadRequestException } from '@nestjs/common';
import { VaultService } from './vault.service';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  assertSignatureFormat,
  decodeConfirmedTransaction,
} from '../execution/onchain-transaction';
import {
  assertLockCustody,
  lockedUiAmount,
  tokenVaultAmount,
  verifyVaultInstruction,
} from './vault-confirmation';
import {
  deriveLockbox,
  deriveTokenVault,
  encodeLockTokens,
  encodeWithdrawTokens,
} from './vault-transaction.builder';

const programId = new PublicKey('4yBSLwXvYQhHExDuvuuEsaHfUC392SdRSiM8r6m832Mj');
const tokenProgram = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const mint = new PublicKey('So11111111111111111111111111111111111111112');
const blockhash = '11111111111111111111111111111111';

function vaultTransaction(
  signer: Keypair,
  data: Buffer,
  options: { user?: PublicKey; lockbox?: PublicKey; program?: PublicKey } = {},
) {
  const user = options.user ?? signer.publicKey;
  const lockbox = options.lockbox ?? deriveLockbox(user, mint, programId);
  const tx = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: blockhash,
  });
  tx.add(
    new TransactionInstruction({
      programId: options.program ?? programId,
      keys: [
        {
          pubkey: user,
          isSigner: user.equals(signer.publicKey),
          isWritable: true,
        },
        { pubkey: mint, isSigner: false, isWritable: false },
        {
          pubkey: Keypair.generate().publicKey,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: lockbox, isSigner: false, isWritable: true },
        {
          pubkey: deriveTokenVault(lockbox, programId),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data,
    }),
  );
  tx.sign(signer);
  const signature = bs58.encode(tx.signature!);
  const raw = {
    transaction: [tx.serialize().toString('base64'), 'base64'] as [
      string,
      string,
    ],
    meta: {
      err: null,
      postTokenBalances: [
        { mint: mint.toBase58(), uiTokenAmount: { decimals: 6 } },
      ],
    },
  };
  return {
    signature,
    confirmed: decodeConfirmedTransaction(raw, signature),
    lockbox,
  };
}

describe('vault confirmation', () => {
  const owner = Keypair.generate();
  const wallet = owner.publicKey.toBase58();

  it('reads the locked amount and unlock time from the instruction itself', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeLockTokens(2_500_000n, 1_900_000_000n),
    );
    const lock = verifyVaultInstruction(confirmed, {
      wallet,
      programId: programId.toBase58(),
      instruction: 'lock_tokens',
      lockAddress: lockbox.toBase58(),
    });
    expect(lock).toEqual({
      mint: mint.toBase58(),
      lockAddress: lockbox.toBase58(),
      tokenVault: deriveTokenVault(lockbox, programId).toBase58(),
      amountRaw: 2_500_000n,
      unlockTime: 1_900_000_000n,
    });
    expect(lockedUiAmount(confirmed, lock.mint, lock.amountRaw!)).toBe(2.5);
  });

  it('accepts the owner withdrawing from their own lock', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeWithdrawTokens(),
    );
    expect(
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: lockbox.toBase58(),
      }).lockAddress,
    ).toBe(lockbox.toBase58());
  });

  it('rejects an unrelated confirmed transaction used to clear a victim lock', () => {
    const attacker = Keypair.generate();
    const victimLock = deriveLockbox(owner.publicKey, mint, programId);
    const { confirmed } = vaultTransaction(attacker, encodeWithdrawTokens());
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: victimLock.toBase58(),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a withdraw that targets a different lock', () => {
    const { confirmed } = vaultTransaction(owner, encodeWithdrawTokens());
    const otherLock = deriveLockbox(owner.publicKey, tokenProgram, programId);
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: otherLock.toBase58(),
      }),
    ).toThrow('another lock');
  });

  it('rejects a lock instruction submitted as an unlock', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeLockTokens(1n, 1_900_000_000n),
    );
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: lockbox.toBase58(),
      }),
    ).toThrow('exactly one vault withdraw_tokens');
  });

  it('rejects an instruction sent to another program', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeWithdrawTokens(),
      {
        program: Keypair.generate().publicKey,
      },
    );
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'withdraw_tokens',
        lockAddress: lockbox.toBase58(),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects failed and unconfirmed transactions', () => {
    const { signature, confirmed } = vaultTransaction(
      owner,
      encodeWithdrawTokens(),
    );
    expect(() =>
      decodeConfirmedTransaction(
        {
          ...confirmed.raw,
          meta: { err: { InstructionError: [0, 'Custom'] } },
        },
        signature,
      ),
    ).toThrow('failed on chain');
    expect(() => decodeConfirmedTransaction(null, signature)).toThrow(
      'not confirmed yet',
    );
  });

  it('rejects bytes that do not match the reported signature', () => {
    const { confirmed } = vaultTransaction(owner, encodeWithdrawTokens());
    const other = vaultTransaction(owner, encodeLockTokens(1n, 1n));
    expect(() =>
      decodeConfirmedTransaction(confirmed.raw, other.signature),
    ).toThrow('does not match');
  });

  it('rejects malformed signatures before any RPC call', () => {
    expect(() => assertSignatureFormat('sig')).toThrow(BadRequestException);
    expect(() => assertSignatureFormat('0OIl')).toThrow(BadRequestException);
  });

  it('rejects a lock that also withdraws in the same transaction', () => {
    const ownerTx = new Transaction({
      feePayer: owner.publicKey,
      recentBlockhash: blockhash,
    });
    const lockbox = deriveLockbox(owner.publicKey, mint, programId);
    const keys = [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: lockbox, isSigner: false, isWritable: true },
      {
        pubkey: deriveTokenVault(lockbox, programId),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ];
    ownerTx.add(
      new TransactionInstruction({
        programId,
        keys,
        data: encodeLockTokens(2_500_000n, 0n),
      }),
      new TransactionInstruction({
        programId,
        keys,
        data: encodeWithdrawTokens(),
      }),
    );
    ownerTx.sign(owner);
    const signature = bs58.encode(ownerTx.signature!);
    const confirmed = decodeConfirmedTransaction(
      {
        transaction: [ownerTx.serialize().toString('base64'), 'base64'],
        meta: {
          err: null,
          postTokenBalances: [
            { mint: mint.toBase58(), uiTokenAmount: { decimals: 6 } },
          ],
        },
      },
      signature,
    );
    expect(() =>
      verifyVaultInstruction(confirmed, {
        wallet,
        programId: programId.toBase58(),
        instruction: 'lock_tokens',
        lockAddress: lockbox.toBase58(),
      }),
    ).toThrow('also withdraws');
  });

  it('rejects a historical lock once the vault no longer holds the tokens', () => {
    const { confirmed, lockbox } = vaultTransaction(
      owner,
      encodeLockTokens(2_500_000n, 1_900_000_000n),
    );
    const lock = verifyVaultInstruction(confirmed, {
      wallet,
      programId: programId.toBase58(),
      instruction: 'lock_tokens',
      lockAddress: lockbox.toBase58(),
    });
    const empty = tokenAccount(mint, lockbox, 0n);
    expect(() => assertLockCustody(lock, empty)).toThrow(
      'no longer in the vault',
    );
    expect(() => assertLockCustody(lock, null)).toThrow(
      'no longer in the vault',
    );
    const held = tokenAccount(mint, lockbox, 2_500_000n);
    expect(tokenVaultAmount(held, lock.mint, lock.lockAddress)).toBe(
      2_500_000n,
    );
    expect(() => assertLockCustody(lock, held)).not.toThrow();
  });
});

describe('VaultService confirmLock custody', () => {
  const owner = Keypair.generate();
  const wallet = owner.publicKey.toBase58();

  function serviceWith(account: Buffer | null) {
    const repository = {
      upsertLock: jest.fn(),
      recordExecution: jest.fn(),
    };
    const alchemy = {
      getConfirmedRawTransaction: jest.fn(),
      getAccountData: jest.fn().mockResolvedValue(account),
    };
    const portfolio = { getPortfolio: jest.fn().mockResolvedValue({}) };
    const built = new VaultService(
      repository as never,
      {} as never,
      alchemy as never,
      portfolio as never,
      {} as never,
      {
        VAULT_PROGRAM_LIVE: true,
        VAULT_PROGRAM_ID: programId.toBase58(),
      } as never,
    );
    return { built, repository, alchemy };
  }

  function lockRaw(amount: bigint) {
    const lockbox = deriveLockbox(owner.publicKey, mint, programId);
    const tx = new Transaction({
      feePayer: owner.publicKey,
      recentBlockhash: blockhash,
    });
    tx.add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: owner.publicKey, isSigner: true, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          {
            pubkey: Keypair.generate().publicKey,
            isSigner: false,
            isWritable: true,
          },
          { pubkey: lockbox, isSigner: false, isWritable: true },
          {
            pubkey: deriveTokenVault(lockbox, programId),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ],
        data: encodeLockTokens(amount, 1_900_000_000n),
      }),
    );
    tx.sign(owner);
    return {
      lockbox,
      signature: bs58.encode(tx.signature!),
      raw: {
        transaction: [tx.serialize().toString('base64'), 'base64'] as [
          string,
          string,
        ],
        meta: {
          err: null,
          postTokenBalances: [
            { mint: mint.toBase58(), uiTokenAmount: { decimals: 6 } },
          ],
        },
      },
    };
  }

  it('indexes a lock only while the vault still holds the instruction amount', async () => {
    const { lockbox, signature, raw } = lockRaw(2_500_000n);
    const held = serviceWith(tokenAccount(mint, lockbox, 2_500_000n));
    held.alchemy.getConfirmedRawTransaction.mockResolvedValue(raw);
    await held.built.confirmLock({
      wallet,
      signature,
      lockAddress: lockbox.toBase58(),
      mint: mint.toBase58(),
      amount: 1,
      unlockAt: new Date(0),
    });
    expect(held.repository.upsertLock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2.5, mint: mint.toBase58() }),
    );

    const empty = serviceWith(tokenAccount(mint, lockbox, 0n));
    empty.alchemy.getConfirmedRawTransaction.mockResolvedValue(raw);
    await expect(
      empty.built.confirmLock({
        wallet,
        signature,
        lockAddress: lockbox.toBase58(),
        mint: mint.toBase58(),
        amount: 99,
        unlockAt: new Date(),
      }),
    ).rejects.toThrow('no longer in the vault');
    expect(empty.repository.upsertLock).not.toHaveBeenCalled();
  });
});

function tokenAccount(
  mintKey: PublicKey,
  authority: PublicKey,
  amount: bigint,
) {
  const data = Buffer.alloc(165);
  mintKey.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return data;
}
