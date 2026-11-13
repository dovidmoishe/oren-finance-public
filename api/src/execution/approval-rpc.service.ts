import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  simulationFailureCode,
  SOL_RENT_MESSAGE,
  SOL_FEE_MESSAGE,
} from './simulation-failure';
import {
  INSUFFICIENT_BALANCE_MESSAGE,
  simulationReason,
  slippageExceededMessage,
} from './simulation-reason';
import { VersionedTransaction } from '@solana/web3.js';
import { createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';
import { AlchemyClient } from '../alchemy/alchemy.client';
import {
  checkSimulatedBalances,
  probeBalances,
  type SimulatedAccount,
  simulationAddresses,
} from './swap-balance-guard';
import type { SwapExpectation } from './swap-terms';

@Injectable()
export class ApprovalRpc {
  private readonly logger = new Logger(ApprovalRpc.name);
  constructor(private readonly rpc: AlchemyClient) {}
  decode(transaction: string, wallet: string) {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(transaction, 'base64'),
    );
    if (
      tx.message.staticAccountKeys[0]?.toBase58() !== wallet ||
      tx.message.header.numRequiredSignatures < 1
    ) {
      throw new BadRequestException(
        'Prepared transaction does not belong to your wallet',
      );
    }
    return tx;
  }
  /**
   * Simulate the exact bytes the user will sign. For swaps, `expectation`
   * adds a venue-neutral balance check: the simulated output received must
   * meet the reviewed minimum and SOL leaving the wallet must stay within
   * the input + fee + rent allowance.
   */
  async inspect(
    transaction: string,
    wallet: string,
    expectation?: SwapExpectation,
  ) {
    const tx = this.decode(transaction, wallet);
    const probe = expectation
      ? await probeBalances(this.rpc, wallet, expectation)
      : undefined;
    const addresses = probe ? simulationAddresses(probe) : undefined;
    const [simulated, fee] = await Promise.all([
      this.rpc.call<{
        value: { err: unknown; accounts?: (SimulatedAccount | null)[] | null };
      }>('simulateTransaction', [
        transaction,
        {
          encoding: 'base64',
          sigVerify: false,
          commitment: 'confirmed',
          ...(addresses ? { accounts: { encoding: 'base64', addresses } } : {}),
        },
      ]),
      this.rpc.call<{ value: number | null }>('getFeeForMessage', [
        Buffer.from(tx.message.serialize()).toString('base64'),
        { commitment: 'confirmed' },
      ]),
    ]);
    if (simulated.value.err) {
      const failure = simulated.value.err as { InstructionError?: unknown[] };
      const index = failure?.InstructionError?.[0];
      const instruction =
        typeof index === 'number' && index >= 0
          ? tx.message.compiledInstructions[index]
          : undefined;
      const program = instruction
        ? tx.message.staticAccountKeys[instruction.programIdIndex]?.toBase58()
        : undefined;
      const failureCode = simulationFailureCode(simulated.value.err);
      const reason = simulationReason(simulated.value.err, program);
      this.logger.warn(`Transaction simulation rejected: ${failureCode}`);
      if (
        reason === 'insufficient_sol_for_rent' ||
        failureCode.startsWith('insufficient_rent_account_')
      )
        throw new BadRequestException({
          message: SOL_RENT_MESSAGE,
          code: 'INSUFFICIENT_SOL_FOR_RENT',
        });
      if (reason === 'insufficient_sol_for_fees')
        throw new BadRequestException({
          message: SOL_FEE_MESSAGE,
          code: 'INSUFFICIENT_SOL_FOR_FEES',
        });
      if (reason === 'slippage_exceeded')
        throw new BadRequestException({
          message: slippageExceededMessage(),
          code: 'QUOTE_SLIPPAGE_EXCEEDED',
        });
      if (reason === 'insufficient_balance')
        throw new BadRequestException({
          message: INSUFFICIENT_BALANCE_MESSAGE,
          code: 'INSUFFICIENT_BALANCE',
        });
      throw new BadRequestException({
        message:
          'This transaction could not be simulated. Check your USDC and SOL balances and request a fresh quote.',
        code: 'SIMULATION_FAILED',
      });
    }
    if (fee.value === null)
      throw new BadRequestException(
        'Transaction expired. Request a fresh quote.',
      );
    if (probe && expectation && addresses) {
      const check = checkSimulatedBalances(
        probe,
        expectation,
        addresses,
        simulated.value.accounts ?? [],
        BigInt(fee.value),
      );
      if (!check.ok) {
        this.logger.warn(
          `swap balance check failed for ${wallet}: ${check.reason}`,
        );
        throw new BadRequestException(
          'This trade no longer matches the terms you reviewed. Review a fresh quote.',
        );
      }
    }
    return String(fee.value);
  }

  /** Current confirmed slot, for routes that carry a slot expiry. */
  async currentSlot() {
    return this.rpc.call<number>('getSlot', [{ commitment: 'confirmed' }]);
  }

  validateSigned(unsigned: string, signed: string, wallet: string) {
    const original = this.decode(unsigned, wallet);
    const tx = this.decode(signed, wallet);
    const message = Buffer.from(tx.message.serialize());
    if (!message.equals(Buffer.from(original.message.serialize())))
      throw new BadRequestException(
        'Signed transaction does not match your approval',
      );
    for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
      const key = createPublicKey({
        key: Buffer.concat([
          Buffer.from('302a300506032b6570032100', 'hex'),
          tx.message.staticAccountKeys[i].toBuffer(),
        ]),
        format: 'der',
        type: 'spki',
      });
      if (!verify(null, message, key, tx.signatures[i]))
        throw new BadRequestException(
          'Transaction signature could not be verified',
        );
    }
    return bs58.encode(tx.signatures[0]);
  }
  async broadcast(transaction: string) {
    return this.rpc.call<string>('sendTransaction', [
      transaction,
      {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      },
    ]);
  }
  async status(signature: string, signal?: AbortSignal) {
    const result = await this.rpc.call<{
      value: ({ err: unknown; confirmationStatus: string | null } | null)[];
    }>(
      'getSignatureStatuses',
      [[signature], { searchTransactionHistory: true }],
      signal,
    );
    return result.value[0];
  }
  async expiryHeight() {
    const result = await this.rpc.call<{
      value: { lastValidBlockHeight: number };
    }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const height = result.value.lastValidBlockHeight;
    if (!Number.isSafeInteger(height) || height <= 0)
      throw new BadRequestException('Unable to determine transaction validity');
    return height;
  }
  async blockhashValid(
    transaction: string,
    wallet: string,
    expiryHeight?: number,
  ) {
    // A recent confirmed blockhash can be absent from the finalized bank. That
    // absence alone must never declare an uncertain submission safe to repeat.
    if (!expiryHeight || !Number.isSafeInteger(expiryHeight)) return true;
    const finalizedHeight = await this.rpc.call<number>('getBlockHeight', [
      { commitment: 'finalized' },
    ]);
    if (finalizedHeight <= expiryHeight) return true;
    const tx = this.decode(transaction, wallet);
    return (
      await this.rpc.call<{ value: boolean }>('isBlockhashValid', [
        tx.message.recentBlockhash,
        { commitment: 'finalized' },
      ])
    ).value;
  }
}
