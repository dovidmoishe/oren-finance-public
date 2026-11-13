import { PublicKey } from '@solana/web3.js';
import {
  decimalToRaw,
  deriveLockbox,
  deriveTokenVault,
  discriminator,
  encodeLockTokens,
  encodeWithdrawTokens,
} from './vault-transaction.builder';

describe('vault transaction builder helpers', () => {
  const programId = new PublicKey('4yBSLwXvYQhHExDuvuuEsaHfUC392SdRSiM8r6m832Mj');
  const wallet = new PublicKey('11111111111111111111111111111111');
  const mint = new PublicKey('So11111111111111111111111111111111111111112');

  it('encodes lock_tokens data with Anchor discriminator and little-endian args', () => {
    const data = encodeLockTokens(1_500_000n, 1_800_000_000n);

    expect(data).toHaveLength(24);
    expect(data.subarray(0, 8)).toEqual(discriminator('lock_tokens'));
    expect(data.readBigUInt64LE(8)).toBe(1_500_000n);
    expect(data.readBigInt64LE(16)).toBe(1_800_000_000n);
  });

  it('encodes withdraw_tokens discriminator only', () => {
    expect(encodeWithdrawTokens()).toEqual(discriminator('withdraw_tokens'));
  });

  it('derives deterministic lockbox and token vault PDAs', () => {
    const lockbox = deriveLockbox(wallet, mint, programId);
    const tokenVault = deriveTokenVault(lockbox, programId);

    expect(deriveLockbox(wallet, mint, programId).toBase58()).toBe(
      lockbox.toBase58(),
    );
    expect(deriveTokenVault(lockbox, programId).toBase58()).toBe(
      tokenVault.toBase58(),
    );
  });

  it('converts decimal UI amounts to raw token units', () => {
    expect(decimalToRaw(1.25, 6)).toBe(1_250_000n);
  });
});
