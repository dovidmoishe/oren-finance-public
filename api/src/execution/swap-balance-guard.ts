import { PublicKey } from '@solana/web3.js';
import type { SwapExpectation } from './swap-terms';

/**
 * Last-line-of-defence check for swaps, venue-neutral: simulate the exact
 * transaction the user will sign and compare the wallet's balances before
 * and after against the terms the user reviewed.
 *
 * - output token received ≥ expectation.minOutRaw
 * - input token spent ≤ expectation.maxInRaw
 * - SOL leaving the wallet ≤ (SOL input, if any) + network fee + rent
 *   allowance for creating the user's own token accounts
 */

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** Rent for up to two of the user's own token accounts (Token-2022 incl.). */
export const RENT_ALLOWANCE_LAMPORTS = 5_000_000;
/** No swap may cost more than this in network fees (0.01 SOL). */
export const MAX_SWAP_NETWORK_FEE_LAMPORTS = 10_000_000;

/** Offset of the u64 `amount` in an SPL Token / Token-2022 account. */
const TOKEN_AMOUNT_OFFSET = 64;

export interface RpcCaller {
  call<T>(method: string, params: unknown[]): Promise<T>;
}

export interface SimulatedAccount {
  data?: [string, string] | string[];
  lamports?: number;
  owner?: string;
}

export interface BalanceProbe {
  wallet: string;
  /** Token accounts holding the input mint (empty for native SOL input). */
  inputAccounts: string[];
  /** Token accounts that can receive the output mint (empty for SOL). */
  outputAccounts: string[];
  /** Pre-simulation raw token amounts by account. */
  pre: Map<string, bigint>;
  preLamports: bigint;
}

export interface BalanceCheckResult {
  ok: boolean;
  reason?: string;
  outReceivedRaw: bigint;
  inSpentRaw: bigint;
  lamportsOut: bigint;
}

export function associatedTokenAddresses(
  wallet: string,
  mint: string,
): string[] {
  return [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) =>
    PublicKey.findProgramAddressSync(
      [
        new PublicKey(wallet).toBuffer(),
        new PublicKey(program).toBuffer(),
        new PublicKey(mint).toBuffer(),
      ],
      new PublicKey(ATA_PROGRAM_ID),
    )[0].toBase58(),
  );
}

export function tokenAmount(
  account: SimulatedAccount | null | undefined,
): bigint {
  const b64 = account?.data?.[0];
  if (!b64) return 0n;
  const data = Buffer.from(b64, 'base64');
  if (data.length < TOKEN_AMOUNT_OFFSET + 8) return 0n;
  return data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
}

interface OwnerAccountsResponse {
  value: { pubkey: string; account: SimulatedAccount }[];
}

async function tokenAccountsFor(
  rpc: RpcCaller,
  wallet: string,
  mint: string,
  pre: Map<string, bigint>,
): Promise<string[]> {
  if (mint === NATIVE_SOL_MINT) return [];
  const owned = await rpc.call<OwnerAccountsResponse>(
    'getTokenAccountsByOwner',
    [wallet, { mint }, { encoding: 'base64', commitment: 'confirmed' }],
  );
  const addresses = new Set<string>();
  for (const row of owned?.value ?? []) {
    addresses.add(row.pubkey);
    pre.set(row.pubkey, tokenAmount(row.account));
  }
  // Accounts the swap may create (first buy) start at 0.
  for (const ata of associatedTokenAddresses(wallet, mint)) {
    addresses.add(ata);
    if (!pre.has(ata)) pre.set(ata, 0n);
  }
  return [...addresses];
}

/** Read the wallet's pre-trade balances for the accounts the swap touches. */
export async function probeBalances(
  rpc: RpcCaller,
  wallet: string,
  expectation: SwapExpectation,
): Promise<BalanceProbe> {
  const pre = new Map<string, bigint>();
  const [inputAccounts, outputAccounts, balance] = await Promise.all([
    tokenAccountsFor(rpc, wallet, expectation.inputMint, pre),
    tokenAccountsFor(rpc, wallet, expectation.outputMint, pre),
    rpc.call<{ value: number }>('getBalance', [
      wallet,
      { commitment: 'confirmed' },
    ]),
  ]);
  return {
    wallet,
    inputAccounts,
    outputAccounts,
    pre,
    preLamports: BigInt(balance?.value ?? 0),
  };
}

/** Addresses to request from simulateTransaction, wallet first. */
export function simulationAddresses(probe: BalanceProbe): string[] {
  return [
    ...new Set([probe.wallet, ...probe.inputAccounts, ...probe.outputAccounts]),
  ];
}

/**
 * Compare post-simulation account states (same order as
 * `simulationAddresses`) with the probe and the reviewed expectation.
 */
export function checkSimulatedBalances(
  probe: BalanceProbe,
  expectation: SwapExpectation,
  addresses: string[],
  accounts: (SimulatedAccount | null)[],
  feeLamports: bigint,
): BalanceCheckResult {
  const post = new Map<string, SimulatedAccount | null>();
  addresses.forEach((address, i) => post.set(address, accounts[i] ?? null));

  const delta = (list: string[]) =>
    list.reduce(
      (sum, address) =>
        sum + tokenAmount(post.get(address)) - (probe.pre.get(address) ?? 0n),
      0n,
    );

  const outReceivedRaw = delta(probe.outputAccounts);
  const inSpentRaw = -delta(probe.inputAccounts);
  const postLamports = BigInt(post.get(probe.wallet)?.lamports ?? 0);
  const lamportsOut = probe.preLamports - postLamports;
  const minOut = BigInt(expectation.minOutRaw);
  const maxIn = BigInt(expectation.maxInRaw);
  const nativeIn = expectation.inputMint === NATIVE_SOL_MINT ? maxIn : 0n;
  const nativeOut = expectation.outputMint === NATIVE_SOL_MINT;
  const result = (reason?: string): BalanceCheckResult => ({
    ok: !reason,
    reason,
    outReceivedRaw,
    inSpentRaw,
    lamportsOut,
  });

  if (!post.get(probe.wallet)) {
    return result('simulation did not return the wallet account');
  }
  if (feeLamports > BigInt(MAX_SWAP_NETWORK_FEE_LAMPORTS)) {
    return result(`network fee ${feeLamports} exceeds the swap fee cap`);
  }
  const allowance = BigInt(RENT_ALLOWANCE_LAMPORTS);
  if (nativeOut) {
    // SOL output lands as lamports, net of fee and any rent.
    if (-lamportsOut + feeLamports + allowance < minOut) {
      return result(`SOL received below the reviewed minimum ${minOut}`);
    }
  } else {
    if (outReceivedRaw < minOut) {
      return result(
        `output received ${outReceivedRaw} below the reviewed minimum ${minOut}`,
      );
    }
    if (lamportsOut > nativeIn + feeLamports + allowance) {
      return result(`SOL outflow ${lamportsOut} exceeds input + fee + rent`);
    }
  }
  if (nativeIn === 0n && inSpentRaw > maxIn) {
    return result(`input spent ${inSpentRaw} exceeds the reviewed ${maxIn}`);
  }
  return result();
}
