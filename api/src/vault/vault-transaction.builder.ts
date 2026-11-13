import { Inject, Injectable } from '@nestjs/common';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';

export interface BuildLockInput {
  wallet: string;
  mint: string;
  userTokenAccount: string;
  tokenProgramId: string;
  amountRaw: bigint;
  unlockAt: Date;
}

export interface BuildUnlockInput {
  wallet: string;
  mint: string;
  tokenProgramId: string;
}

export interface BuiltVaultTransaction {
  transaction: string;
  lockAddress: string;
  tokenVaultAddress: string;
}

@Injectable()
export class VaultTransactionBuilder {
  private readonly connection: Connection;
  private readonly programId: PublicKey;

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    this.connection = new Connection(rpcUrl(env), 'confirmed');
    this.programId = new PublicKey(env.VAULT_PROGRAM_ID);
  }

  async buildLock(input: BuildLockInput): Promise<BuiltVaultTransaction> {
    const wallet = new PublicKey(input.wallet);
    const mint = new PublicKey(input.mint);
    const userTokenAccount = new PublicKey(input.userTokenAccount);
    const tokenProgram = new PublicKey(input.tokenProgramId);
    const lockbox = deriveLockbox(wallet, mint, this.programId);
    const tokenVault = deriveTokenVault(lockbox, this.programId);

    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: lockbox, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: encodeLockTokens(input.amountRaw, toUnixSeconds(input.unlockAt)),
    });

    return this.serialize(wallet, [instruction], lockbox, tokenVault);
  }

  async buildUnlock(input: BuildUnlockInput): Promise<BuiltVaultTransaction> {
    const wallet = new PublicKey(input.wallet);
    const mint = new PublicKey(input.mint);
    const tokenProgram = new PublicKey(input.tokenProgramId);
    const lockbox = deriveLockbox(wallet, mint, this.programId);
    const tokenVault = deriveTokenVault(lockbox, this.programId);
    const userTokenAccount = getAssociatedTokenAddressSync(
      mint,
      wallet,
      false,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const createUserAta = createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      userTokenAccount,
      wallet,
      mint,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const withdraw = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: wallet, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: lockbox, isSigner: false, isWritable: true },
        { pubkey: tokenVault, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: encodeWithdrawTokens(),
    });

    return this.serialize(wallet, [createUserAta, withdraw], lockbox, tokenVault);
  }

  async getTokenProgramId(mint: string): Promise<string> {
    const account = await this.connection.getAccountInfo(new PublicKey(mint));
    const owner = account?.owner?.toBase58();
    if (owner === TOKEN_PROGRAM_ID.toBase58()) return owner;
    if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return owner;
    return TOKEN_PROGRAM_ID.toBase58();
  }

  private async serialize(
    wallet: PublicKey,
    instructions: TransactionInstruction[],
    lockbox: PublicKey,
    tokenVault: PublicKey,
  ): Promise<BuiltVaultTransaction> {
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: wallet,
      recentBlockhash: blockhash,
    });
    tx.add(...instructions);

    return {
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      lockAddress: lockbox.toBase58(),
      tokenVaultAddress: tokenVault.toBase58(),
    };
  }
}

export function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export function encodeLockTokens(amount: bigint, unlockTime: bigint): Buffer {
  const data = Buffer.alloc(24);
  discriminator('lock_tokens').copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigInt64LE(unlockTime, 16);
  return data;
}

export function encodeWithdrawTokens(): Buffer {
  return discriminator('withdraw_tokens');
}

export function deriveLockbox(
  wallet: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lockbox'), wallet.toBuffer(), mint.toBuffer()],
    programId,
  )[0];
}

export function deriveTokenVault(
  lockbox: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), lockbox.toBuffer()],
    programId,
  )[0];
}

export function decimalToRaw(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be > 0');
  }
  const [whole, fraction = ''] = String(amount).split('.');
  const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

function toUnixSeconds(date: Date): bigint {
  return BigInt(Math.floor(date.getTime() / 1000));
}

function rpcUrl(env: AppEnv): string {
  const network =
    env.SOLANA_NETWORK === 'devnet' ? 'solana-devnet' : 'solana-mainnet';
  return `https://${network}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
}
