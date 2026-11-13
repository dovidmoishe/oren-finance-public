import { BadRequestException, Injectable } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { AlchemyService } from '../alchemy/alchemy.service';
import type { AlchemyRawTransaction } from '../alchemy/alchemy.types';

export interface ConfirmedTransaction {
  transaction: VersionedTransaction;
  /** Static keys followed by lookup-table addresses, in message order. */
  accountKeys: string[];
  raw: AlchemyRawTransaction;
}

/** Reject anything that is not a base58 Ed25519 signature before calling RPC. */
export function assertSignatureFormat(signature: string): string {
  const value = signature?.trim() ?? '';
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw new BadRequestException(
      'signature is not a valid transaction signature',
    );
  }
  if (bytes.length !== 64)
    throw new BadRequestException(
      'signature is not a valid transaction signature',
    );
  return value;
}

/** Decode a successful confirmed transaction and resolve its full account list. */
export function decodeConfirmedTransaction(
  raw: AlchemyRawTransaction | null | undefined,
  signature: string,
): ConfirmedTransaction {
  if (!raw?.transaction?.[0] || !raw.meta)
    throw new BadRequestException(
      'Transaction is not confirmed yet. Retry after it lands on chain.',
    );
  if (raw.meta.err)
    throw new BadRequestException('Transaction failed on chain');
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(
      Buffer.from(raw.transaction[0], 'base64'),
    );
  } catch {
    throw new BadRequestException('Transaction could not be decoded');
  }
  if (bs58.encode(transaction.signatures[0] ?? new Uint8Array()) !== signature)
    throw new BadRequestException('Transaction does not match signature');
  return {
    transaction,
    accountKeys: [
      ...transaction.message.staticAccountKeys.map((key) => key.toBase58()),
      ...(raw.meta.loadedAddresses?.writable ?? []),
      ...(raw.meta.loadedAddresses?.readonly ?? []),
    ],
    raw,
  };
}

/** The wallet must be the fee payer and first signer of the transaction. */
export function assertFeePayer(
  confirmed: ConfirmedTransaction,
  wallet: string,
) {
  const { message } = confirmed.transaction;
  if (
    message.header.numRequiredSignatures < 1 ||
    message.staticAccountKeys[0]?.toBase58() !== wallet
  )
    throw new BadRequestException('Transaction was not signed by this wallet');
}

/**
 * The landed transaction must be the exact unsigned transaction the server
 * prepared. A different message that merely mentions an account does not
 * qualify, including a limit-order open transaction presented as a cancel.
 */
export function assertPreparedMessage(
  confirmed: ConfirmedTransaction,
  preparedTransaction: string,
): void {
  const prepared = decodePreparedTransaction(preparedTransaction);
  const landed = Buffer.from(confirmed.transaction.message.serialize());
  const expected = Buffer.from(prepared.message.serialize());
  if (!landed.equals(expected))
    throw new BadRequestException(
      'Transaction does not match the prepared transaction',
    );
}

/**
 * Prove a reported signature was produced by signing this prepared message.
 * Used when the client reports a signature before the transaction is confirmed.
 */
export function assertSignedPreparedTransaction(
  unsignedTransaction: string,
  signature: string,
  wallet: string,
): void {
  const prepared = decodePreparedTransaction(unsignedTransaction);
  const feePayer = prepared.message.staticAccountKeys[0];
  if (
    prepared.message.header.numRequiredSignatures < 1 ||
    feePayer?.toBase58() !== wallet
  )
    throw new BadRequestException(
      'Prepared transaction was not paid by this wallet',
    );
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signature);
  } catch {
    throw new BadRequestException(
      'signature is not a valid transaction signature',
    );
  }
  if (sig.length !== 64)
    throw new BadRequestException(
      'signature is not a valid transaction signature',
    );
  const message = Buffer.from(prepared.message.serialize());
  if (!verifyEd25519(message, sig, feePayer.toBytes()))
    throw new BadRequestException(
      'Signature does not match the prepared transaction',
    );
}

function decodePreparedTransaction(transaction: string): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
  } catch {
    throw new BadRequestException('Prepared transaction could not be decoded');
  }
}

function verifyEd25519(
  message: Buffer,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKey),
      ]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** Confirms client-reported signatures against the chain before any DB write. */
@Injectable()
export class OnchainTransactions {
  constructor(private readonly alchemy: AlchemyService) {}

  async confirmed(signature: string): Promise<ConfirmedTransaction> {
    const value = assertSignatureFormat(signature);
    return decodeConfirmedTransaction(
      await this.alchemy.getConfirmedRawTransaction(value),
      value,
    );
  }

  /**
   * The confirmed transaction is the prepared one, paid by `wallet`.
   * `account`, when set, must be referenced by that prepared message.
   */
  async assertPreparedTransaction(
    signature: string,
    wallet: string,
    preparedTransaction: string,
    account?: string,
  ): Promise<ConfirmedTransaction> {
    const confirmed = await this.confirmed(signature);
    assertFeePayer(confirmed, wallet);
    assertPreparedMessage(confirmed, preparedTransaction);
    if (account && !confirmed.accountKeys.includes(account))
      throw new BadRequestException(
        'Transaction does not reference the expected account',
      );
    return confirmed;
  }
}
