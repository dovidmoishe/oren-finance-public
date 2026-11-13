import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { AlchemyClient } from '../../alchemy/alchemy.client';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { TitanError } from './titan.errors';
import { optionalU64ToNumber } from './titan.mapper';
import type { TitanInstruction, TitanRoutePayload } from './titan.types';

export const COMPUTE_BUDGET_PROGRAM_ID =
  'ComputeBudget111111111111111111111111111111';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const MEMO_PROGRAM_IDS = [
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
];
/** Titan swap program (Portal docs). Add others via TITAN_EXTRA_PROGRAM_IDS. */
export const TITAN_SWAP_PROGRAM_IDS = [
  'T1TANpTeScyeqVzzgNViGDNrkQ6qHz9KrSBS4aNXvGT',
];

/** ComputeBudget instruction discriminators (first data byte). */
const CB_REQUEST_HEAP_FRAME = 1;
const CB_SET_COMPUTE_UNIT_LIMIT = 2;
const CB_SET_COMPUTE_UNIT_PRICE = 3;
const CB_SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;

/** SPL Token instruction discriminators allowed at top level. */
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_SYNC_NATIVE = 17;
/** ATA program: empty data / 0 = Create, 1 = CreateIdempotent. */
const ATA_CREATE = 0;
const ATA_CREATE_IDEMPOTENT = 1;

const MAX_COMPUTE_UNITS = 1_400_000;
const DEFAULT_COMPUTE_UNITS = 400_000;
/** Solana packet limit for a serialized transaction (v0). */
export const MAX_TX_BYTES = 1232;
/** Refuse to build when the cluster is this close to `expiresAfterSlot`. */
export const SLOT_EXPIRY_MARGIN = 2;

/** Priority fee policy (Jupiter's /swap used to pick this for us). */
export const PRIORITY_FEE_PERCENTILE = 0.75;
export const MIN_PRIORITY_MICRO_LAMPORTS = 1_000;
/** Never spend more than this on priority fees for one swap (0.001 SOL). */
export const MAX_PRIORITY_FEE_LAMPORTS = 1_000_000;
const MAX_FEE_ACCOUNTS = 128;

export interface BuiltTitanTransaction {
  /** Base64 serialized, unsigned v0 transaction. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight?: number;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
  /** computeUnitLimit × price / 1e6, always ≤ MAX_PRIORITY_FEE_LAMPORTS. */
  priorityFeeLamports: number;
  /** Number of Titan SetComputeUnitLimit/Price instructions replaced. */
  strippedComputeBudget: number;
  expiresAfterSlot?: number;
  sizeBytes: number;
}

/**
 * Turns a Titan route into the same artefact Jupiter's POST /swap returns:
 * a base64 unsigned versioned transaction with the user's wallet as fee
 * payer. Safety rules:
 * - only the user's wallet may sign;
 * - every instruction must pass the program/instruction allowlist;
 * - Titan's own compute-unit limit/price instructions are replaced by ours,
 *   and our price is capped so limit × price ≤ MAX_PRIORITY_FEE_LAMPORTS;
 * - lookup tables are always loaded from chain (never trusted inline);
 * - a route past its `expiresAfterSlot` is refused.
 */
@Injectable()
export class TitanTxBuilder {
  private readonly logger = new Logger(TitanTxBuilder.name);
  private readonly allowedSwapPrograms: Set<string>;

  constructor(
    private readonly rpc: AlchemyClient,
    @Optional() @Inject(APP_ENV) env?: Pick<AppEnv, 'TITAN_EXTRA_PROGRAM_IDS'>,
  ) {
    this.allowedSwapPrograms = new Set([
      ...TITAN_SWAP_PROGRAM_IDS,
      ...(env?.TITAN_EXTRA_PROGRAM_IDS ?? []),
    ]);
  }

  async build(
    payload: TitanRoutePayload,
    wallet: string,
  ): Promise<BuiltTitanTransaction> {
    if (payload.wallet !== wallet) {
      throw new TitanError(
        'wallet_mismatch',
        'Titan route was built for a different wallet',
      );
    }
    assertOnlyWalletSigns(payload.route.instructions, wallet);

    const { kept, titanLimit, stripped } = stripComputeBudget(
      payload.route.instructions,
    );
    assertAllowedInstructions(kept, wallet, this.allowedSwapPrograms);
    const instructions = kept.map(toInstruction);

    const computeUnitLimit = clampUnits(
      titanLimit ??
        optionalU64ToNumber(payload.route.computeUnitsSafe) ??
        Math.ceil(
          (optionalU64ToNumber(payload.route.computeUnits) ??
            DEFAULT_COMPUTE_UNITS / 1.2) * 1.2,
        ),
    );
    const expiresAfterSlot = optionalU64ToNumber(
      payload.route.expiresAfterSlot,
    );

    const [computeUnitPriceMicroLamports, lookupTables, latest] =
      await Promise.all([
        this.priorityFee(writableAccounts(kept), computeUnitLimit),
        this.lookupTables(payload),
        this.latestBlockhash(),
        expiresAfterSlot && expiresAfterSlot > 0
          ? this.assertSlotNotExpired(expiresAfterSlot)
          : Promise.resolve(),
      ]);

    const priorityFeeLamports = Math.ceil(
      (computeUnitPriceMicroLamports * computeUnitLimit) / 1_000_000,
    );
    if (priorityFeeLamports > MAX_PRIORITY_FEE_LAMPORTS) {
      // Unreachable by construction; kept as a last line of defence.
      throw new TitanError(
        'tx_build_failed',
        `Priority fee ${priorityFeeLamports} exceeds cap`,
      );
    }

    let serialized: Uint8Array;
    try {
      const message = new TransactionMessage({
        payerKey: new PublicKey(wallet),
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: computeUnitPriceMicroLamports,
          }),
          ...instructions,
        ],
      }).compileToV0Message(lookupTables);
      serialized = new VersionedTransaction(message).serialize();
    } catch (err) {
      throw new TitanError(
        'tx_build_failed',
        `Could not compile Titan transaction: ${
          err instanceof Error ? err.message : String(err)
        }`,
        undefined,
        err,
      );
    }
    if (serialized.length > MAX_TX_BYTES) {
      throw new TitanError(
        'tx_build_failed',
        `Titan transaction is ${serialized.length} bytes (max ${MAX_TX_BYTES})`,
      );
    }

    return {
      transaction: Buffer.from(serialized).toString('base64'),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      computeUnitLimit,
      computeUnitPriceMicroLamports,
      priorityFeeLamports,
      strippedComputeBudget: stripped,
      expiresAfterSlot:
        expiresAfterSlot && expiresAfterSlot > 0 ? expiresAfterSlot : undefined,
      sizeBytes: serialized.length,
    };
  }

  private async assertSlotNotExpired(expiresAfterSlot: number): Promise<void> {
    const slot = await this.rpc.call<number>('getSlot', [
      { commitment: 'confirmed' },
    ]);
    if (
      typeof slot !== 'number' ||
      slot >= expiresAfterSlot - SLOT_EXPIRY_MARGIN
    ) {
      throw new TitanError(
        'stale_quote',
        `Titan route expires after slot ${expiresAfterSlot}; current ${String(slot)}`,
      );
    }
  }

  private async latestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight?: number;
  }> {
    const result = await this.rpc.call<{
      value: { blockhash: string; lastValidBlockHeight?: number };
    }>('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const blockhash = result?.value?.blockhash;
    if (!blockhash) {
      throw new TitanError('tx_build_failed', 'RPC returned no blockhash');
    }
    return {
      blockhash,
      lastValidBlockHeight: result.value.lastValidBlockHeight,
    };
  }

  /**
   * Always load lookup tables from chain. Inline contents from Titan are
   * ignored: if they were stale or wrong, compiled indices would resolve to
   * different accounts on-chain than the ones we checked.
   */
  private async lookupTables(
    payload: TitanRoutePayload,
  ): Promise<AddressLookupTableAccount[]> {
    const wanted = [...new Set(payload.route.addressLookupTables ?? [])];
    if (wanted.length === 0) return [];
    const fetched = await this.fetchLookupTables(wanted);
    return wanted.map((key) => {
      const account = fetched.get(key);
      if (!account) {
        throw new TitanError(
          'tx_build_failed',
          `Address lookup table ${key} not found`,
        );
      }
      if (!account.isActive()) {
        throw new TitanError(
          'tx_build_failed',
          `Address lookup table ${key} is deactivated`,
        );
      }
      return account;
    });
  }

  private async fetchLookupTables(
    keys: string[],
  ): Promise<Map<string, AddressLookupTableAccount>> {
    const result = await this.rpc.call<{
      value: ({ data: [string, string] } | null)[];
    }>('getMultipleAccounts', [
      keys,
      { encoding: 'base64', commitment: 'confirmed' },
    ]);
    const out = new Map<string, AddressLookupTableAccount>();
    keys.forEach((key, index) => {
      const account = result?.value?.[index];
      if (!account?.data?.[0]) return;
      out.set(
        key,
        new AddressLookupTableAccount({
          key: new PublicKey(key),
          state: AddressLookupTableAccount.deserialize(
            Buffer.from(account.data[0], 'base64'),
          ),
        }),
      );
    });
    return out;
  }

  /**
   * 75th percentile of recent prioritisation fees for the accounts this swap
   * writes, floored at MIN_PRIORITY_MICRO_LAMPORTS and hard-capped so that
   * limit × price never exceeds MAX_PRIORITY_FEE_LAMPORTS. RPC failure falls
   * back to the floor.
   */
  async priorityFee(accounts: string[], computeUnits: number): Promise<number> {
    const units = clampUnits(computeUnits);
    const cap = Math.floor((MAX_PRIORITY_FEE_LAMPORTS * 1_000_000) / units);
    let fees: number[] = [];
    try {
      const result = await this.rpc.call<
        { slot: number; prioritizationFee: number }[]
      >('getRecentPrioritizationFees', [accounts.slice(0, MAX_FEE_ACCOUNTS)]);
      fees = (result ?? [])
        .map((row) => Number(row.prioritizationFee))
        .filter((fee) => Number.isFinite(fee) && fee >= 0);
    } catch (err) {
      this.logger.warn(
        `getRecentPrioritizationFees failed; using floor fee: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const estimate = percentile(fees, PRIORITY_FEE_PERCENTILE);
    // The cap always wins over the floor.
    return Math.min(
      cap,
      Math.max(MIN_PRIORITY_MICRO_LAMPORTS, Math.ceil(estimate)),
    );
  }
}

/**
 * Remove Titan's SetComputeUnitLimit / SetComputeUnitPrice instructions
 * (we always add our own, capped). Heap-frame and loaded-data-size requests
 * are kept; any other ComputeBudget instruction is rejected.
 */
export function stripComputeBudget(instructions: TitanInstruction[]): {
  kept: TitanInstruction[];
  titanLimit?: number;
  stripped: number;
} {
  const kept: TitanInstruction[] = [];
  let titanLimit: number | undefined;
  let stripped = 0;
  for (const ix of instructions) {
    if (ix.p !== COMPUTE_BUDGET_PROGRAM_ID) {
      kept.push(ix);
      continue;
    }
    const data = Buffer.from(ix.d ?? '', 'base64');
    const tag = data[0];
    if (tag === CB_SET_COMPUTE_UNIT_LIMIT) {
      if (data.length >= 5) titanLimit = data.readUInt32LE(1);
      stripped += 1;
    } else if (tag === CB_SET_COMPUTE_UNIT_PRICE) {
      stripped += 1;
    } else if (
      tag === CB_REQUEST_HEAP_FRAME ||
      tag === CB_SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT
    ) {
      kept.push(ix);
    } else {
      throw new TitanError(
        'disallowed_instruction',
        `Unsupported ComputeBudget instruction ${String(tag)}`,
      );
    }
  }
  return { kept, titanLimit, stripped };
}

/** Kept for log/inspection callers: what the route asked for. */
export function inspectComputeBudget(instructions: TitanInstruction[]): {
  hasLimit: boolean;
  hasPrice: boolean;
} {
  let hasLimit = false;
  let hasPrice = false;
  for (const ix of instructions) {
    if (ix.p !== COMPUTE_BUDGET_PROGRAM_ID) continue;
    const tag = Buffer.from(ix.d ?? '', 'base64')[0];
    if (tag === CB_SET_COMPUTE_UNIT_LIMIT) hasLimit = true;
    else if (tag === CB_SET_COMPUTE_UNIT_PRICE) hasPrice = true;
  }
  return { hasLimit, hasPrice };
}

/**
 * Program / instruction allowlist for Titan-built transactions. The swap
 * program itself enforces the minimum out; everything around it must be
 * harmless housekeeping for the user's own accounts:
 * - Titan swap program(s) (+ TITAN_EXTRA_PROGRAM_IDS): allowed.
 * - Memo: allowed.
 * - ATA program: Create / CreateIdempotent only, funded by and owned by the
 *   wallet.
 * - SPL Token / Token-2022: SyncNative, or CloseAccount whose rent goes back
 *   to the wallet and whose authority is the wallet. Nothing else (no
 *   Approve, Transfer, SetAuthority…).
 * - System program and anything else: rejected.
 */
export function assertAllowedInstructions(
  instructions: TitanInstruction[],
  wallet: string,
  swapPrograms: ReadonlySet<string> = new Set(TITAN_SWAP_PROGRAM_IDS),
): void {
  const reject = (why: string): never => {
    throw new TitanError('disallowed_instruction', why);
  };
  for (const ix of instructions) {
    const data = Buffer.from(ix.d ?? '', 'base64');
    const accounts = ix.a ?? [];
    if (swapPrograms.has(ix.p) || MEMO_PROGRAM_IDS.includes(ix.p)) continue;
    if (ix.p === COMPUTE_BUDGET_PROGRAM_ID) {
      const tag = data[0];
      if (
        tag === CB_REQUEST_HEAP_FRAME ||
        tag === CB_SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT
      ) {
        continue;
      }
      reject(`ComputeBudget instruction ${String(tag)} not allowed here`);
    }
    if (ix.p === ATA_PROGRAM_ID) {
      const tag = data.length === 0 ? ATA_CREATE : data[0];
      if (tag !== ATA_CREATE && tag !== ATA_CREATE_IDEMPOTENT) {
        reject(`ATA instruction ${tag} not allowed`);
      }
      // Accounts: [funder, ata, owner, mint, system, token program]
      if (accounts[0]?.p !== wallet || accounts[2]?.p !== wallet) {
        reject('ATA creation must be funded by and owned by the wallet');
      }
      continue;
    }
    if (ix.p === TOKEN_PROGRAM_ID || ix.p === TOKEN_2022_PROGRAM_ID) {
      const tag = data[0];
      if (tag === TOKEN_SYNC_NATIVE) continue;
      if (tag === TOKEN_CLOSE_ACCOUNT) {
        // Accounts: [account, destination, authority]
        if (accounts[1]?.p !== wallet || accounts[2]?.p !== wallet) {
          reject('CloseAccount must return rent to the wallet');
        }
        continue;
      }
      reject(`Token instruction ${String(tag)} not allowed`);
    }
    reject(`Program ${ix.p} is not on the Titan allowlist`);
  }
}

/** Privy only signs for the user's wallet; any other signer cannot land. */
export function assertOnlyWalletSigns(
  instructions: TitanInstruction[],
  wallet: string,
): void {
  for (const ix of instructions) {
    for (const meta of ix.a ?? []) {
      if (meta.s && meta.p !== wallet) {
        throw new TitanError(
          'tx_build_failed',
          `Titan route requires an extra signer ${meta.p}`,
        );
      }
    }
  }
}

export function writableAccounts(instructions: TitanInstruction[]): string[] {
  const set = new Set<string>();
  for (const ix of instructions) {
    for (const meta of ix.a ?? []) if (meta.w) set.add(meta.p);
  }
  return [...set];
}

/** Distinct program ids a route uses (for shadow logs / allowlist review). */
export function routeProgramIds(instructions: TitanInstruction[]): string[] {
  return [...new Set(instructions.map((ix) => ix.p))];
}

function toInstruction(ix: TitanInstruction): TransactionInstruction {
  try {
    return new TransactionInstruction({
      programId: new PublicKey(ix.p),
      keys: (ix.a ?? []).map((meta) => ({
        pubkey: new PublicKey(meta.p),
        isSigner: Boolean(meta.s),
        isWritable: Boolean(meta.w),
      })),
      data: Buffer.from(ix.d ?? '', 'base64'),
    });
  } catch (err) {
    throw new TitanError(
      'invalid_response',
      `Malformed Titan instruction for program ${ix.p}`,
      undefined,
      err,
    );
  }
}

function clampUnits(units: number): number {
  if (!Number.isFinite(units) || units <= 0) return DEFAULT_COMPUTE_UNITS;
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(units));
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index];
}
