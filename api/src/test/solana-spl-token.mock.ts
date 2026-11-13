import { PublicKey, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  return new PublicKey(`ata-${owner.toBase58()}-${mint.toBase58()}`);
}

export function createAssociatedTokenAccountIdempotentInstruction() {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [],
    data: Buffer.alloc(0),
  });
}
