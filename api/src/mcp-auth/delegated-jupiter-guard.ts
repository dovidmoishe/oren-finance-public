import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import idl from './jupiter-shared-route.idl.json';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const DISCRIMINATOR = Buffer.from('c1209b3341d69c81', 'hex');
const MAX_TRANSACTION_BYTES = 1232;
const MAX_PRIORITY_FEE_LAMPORTS = 100_000n;
const route = idl.instructions[0];
const definitions = new Map(idl.types.map((item) => [item.name, item.type]));
const protectedNames = [
  'source_mint',
  'destination_mint',
  'source_token_account',
  'destination_token_account',
] as const;

export interface DelegatedJupiterTerms {
  wallet: string;
  inputMint: string;
  outputMint: string;
  sourceAta: string;
  destinationAta: string;
  /** Resolved independently from the on-chain output mint by each cosigner. */
  destinationTokenProgram?: string;
  requireDestinationAccountCreation?: boolean;
  rawInput: string;
  quotedOutputRaw?: string;
  /** Independent cosigner may verify the saved floor without trusting a quote. */
  minimumOutputRaw?: string;
  maxInputRaw: string;
  maxSlippageBps: number;
}

export interface DelegatedJupiterInspection {
  createsDestinationAccount: boolean;
  rawInput: string;
  quotedOutputRaw: string;
  slippageBps: number;
  lookupTableCount: number;
  computeFeeCapLamports: string;
}

function reject(reason: string): never {
  throw new Error(`Delegated Jupiter route rejected: ${reason}`);
}

/** Consume the canonical on-chain Anchor IDL without accepting trailing data. */
function decodeRouteData(data: Buffer) {
  if (data.length < 8 || !data.subarray(0, 8).equals(DISCRIMINATOR))
    reject('wrong instruction discriminator');
  let offset = 8;
  const take = (length: number) => {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset + length > data.length
    )
      reject('truncated or oversized route data');
    const start = offset;
    offset += length;
    return start;
  };
  const read = (type: any): any => {
    if (typeof type === 'string') {
      switch (type) {
        case 'u8':
          return data.readUInt8(take(1));
        case 'u16':
          return data.readUInt16LE(take(2));
        case 'u32':
          return data.readUInt32LE(take(4));
        case 'u64':
          return data.readBigUInt64LE(take(8)).toString();
        case 'u128': {
          const start = take(16);
          return (
            data.readBigUInt64LE(start) +
            (data.readBigUInt64LE(start + 8) << 64n)
          ).toString();
        }
        case 'bool': {
          const value = data.readUInt8(take(1));
          if (value > 1) reject('invalid boolean');
          return value === 1;
        }
        case 'pubkey':
          return new PublicKey(data.subarray(take(32), offset)).toBase58();
        case 'bytes': {
          const length = read('u32');
          take(length);
          return undefined;
        }
        default:
          return reject(`unsupported IDL type ${type}`);
      }
    }
    if (type.defined) {
      const name =
        typeof type.defined === 'string' ? type.defined : type.defined.name;
      const definition: any = definitions.get(name);
      if (!definition) reject(`missing IDL type ${name}`);
      if (definition.kind === 'struct') {
        const fields: Record<string, unknown> = {};
        for (const field of definition.fields)
          fields[field.name] = read(field.type);
        return fields;
      }
      if (definition.kind === 'enum') {
        const variant = definition.variants[read('u8')];
        if (!variant) reject(`invalid enum ${name}`);
        for (const field of variant.fields ?? []) read(field.type ?? field);
        return variant.name;
      }
      return reject(`unsupported IDL definition ${name}`);
    }
    if (type.vec) {
      const count = read('u32');
      if (count > 128) reject('route plan too long');
      for (let index = 0; index < count; index++) read(type.vec);
      return undefined;
    }
    if (type.option) {
      const present = read('u8');
      if (present > 1) reject('invalid option');
      return present ? read(type.option) : null;
    }
    if (type.array) {
      const [member, count] = type.array;
      if (count > 256) reject('IDL array too long');
      for (let index = 0; index < count; index++) read(member);
      return undefined;
    }
    return reject('unsupported IDL value');
  };
  const args: Record<string, any> = {};
  for (const arg of route.args) args[arg.name] = read(arg.type);
  if (offset !== data.length) reject('trailing route data');
  return args;
}

function inspectComputeBudget(
  instructions: ReturnType<typeof TransactionMessage.decompile>['instructions'],
) {
  let units: number | undefined;
  let microLamports: bigint | undefined;
  for (const instruction of instructions) {
    if (instruction.programId.toBase58() !== COMPUTE_BUDGET) continue;
    if (instruction.keys.length !== 0) reject('compute budget has accounts');
    const data = Buffer.from(instruction.data);
    if (data[0] === 2 && data.length === 5 && units === undefined)
      units = data.readUInt32LE(1);
    else if (data[0] === 3 && data.length === 9 && microLamports === undefined)
      microLamports = data.readBigUInt64LE(1);
    else reject('unknown or duplicate compute budget instruction');
  }
  if (units !== undefined && (units < 1 || units > 1_400_000))
    reject('compute unit limit out of range');
  if (
    microLamports !== undefined &&
    units === undefined &&
    instructions.some((item) =>
      item.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
    )
  )
    reject('priced account creation requires an explicit compute unit limit');
  const fee =
    (BigInt(units ?? 200_000) * (microLamports ?? 0n) + 999_999n) / 1_000_000n;
  if (fee > MAX_PRIORITY_FEE_LAMPORTS) reject('priority fee over cap');
  return fee;
}

/** Gate-owned RPC resolver; never accept lookup-table contents from the MCP API. */
export async function inspectDelegatedJupiterTransaction(
  transaction: string,
  expected: DelegatedJupiterTerms,
  resolveTable: (
    address: PublicKey,
  ) => Promise<AddressLookupTableAccount | null>,
): Promise<DelegatedJupiterInspection> {
  const bytes = Buffer.from(transaction, 'base64');
  if (bytes.length > MAX_TRANSACTION_BYTES)
    reject('transaction exceeds packet size');
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch {
    reject('invalid transaction bytes');
  }
  if (
    tx.message.header.numRequiredSignatures !== 1 ||
    tx.message.staticAccountKeys[0]?.toBase58() !== expected.wallet
  )
    reject('unexpected fee payer or signer');
  if (tx.signatures.length !== 1 || tx.signatures[0].some((byte) => byte !== 0))
    reject('transaction was already signed');
  const tables = await Promise.all(
    tx.message.addressTableLookups.map(async (lookup) => {
      const table = await resolveTable(lookup.accountKey);
      if (!table || !table.key.equals(lookup.accountKey))
        reject('lookup table missing or mismatched');
      return table;
    }),
  );
  let instructions: ReturnType<
    typeof TransactionMessage.decompile
  >['instructions'];
  try {
    instructions = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: tables,
    }).instructions;
  } catch {
    reject('lookup table resolution failed');
  }
  const jupiter = instructions.filter(
    (item) => item.programId.toBase58() === JUPITER,
  );
  if (jupiter.length !== 1) reject('expected exactly one Jupiter route');
  const creates = instructions.filter((item) =>
    item.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  if (creates.length > 1) reject('duplicate destination account creation');
  if (expected.requireDestinationAccountCreation && creates.length !== 1)
    reject('missing destination account creation');
  for (const create of creates) {
    if (
      !expected.destinationTokenProgram ||
      ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
        expected.destinationTokenProgram,
      ) ||
      create.data.length !== 1 ||
      create.data[0] !== 1 ||
      create.keys.length !== 6 ||
      instructions.indexOf(create) > instructions.indexOf(jupiter[0])
    )
      reject('invalid idempotent destination account creation');
    const destination = getAssociatedTokenAddressSync(
      new PublicKey(expected.outputMint),
      new PublicKey(expected.wallet),
      false,
      new PublicKey(expected.destinationTokenProgram),
    ).toBase58();
    const accounts = [
      expected.wallet,
      destination,
      expected.wallet,
      expected.outputMint,
      SystemProgram.programId.toBase58(),
      expected.destinationTokenProgram,
    ];
    if (
      destination !== expected.destinationAta ||
      create.keys.some(
        (key, index) => key.pubkey.toBase58() !== accounts[index],
      ) ||
      !create.keys[0].isSigner ||
      !create.keys[0].isWritable ||
      !create.keys[1].isWritable ||
      create.keys.some(
        (key) =>
          !tx.message.staticAccountKeys.some((item) => item.equals(key.pubkey)),
      )
    )
      reject('wrong destination account creation accounts');
  }
  if (
    instructions.some(
      (item) =>
        ![
          JUPITER,
          COMPUTE_BUDGET,
          ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
        ].includes(item.programId.toBase58()),
    )
  )
    reject('unapproved top-level instruction');
  const fee = inspectComputeBudget(instructions);
  const instruction = jupiter[0];
  if (instruction.keys.length < route.accounts.length)
    reject('missing route accounts');
  const key = (name: string) => {
    const index = route.accounts.findIndex((account) => account.name === name);
    if (index < 0) reject(`IDL is missing ${name}`);
    return instruction.keys[index];
  };
  if (
    key('user_transfer_authority').pubkey.toBase58() !== expected.wallet ||
    !key('user_transfer_authority').isSigner
  )
    reject('wrong transfer authority');
  for (const [name, value] of Object.entries({
    source_mint: expected.inputMint,
    destination_mint: expected.outputMint,
    source_token_account: expected.sourceAta,
    destination_token_account: expected.destinationAta,
  })) {
    if (key(name).pubkey.toBase58() !== value) reject(`wrong ${name}`);
  }
  const staticKeys = new Set(
    tx.message.staticAccountKeys.map((item) => item.toBase58()),
  );
  if (
    protectedNames.some((name) => !staticKeys.has(key(name).pubkey.toBase58()))
  )
    reject('protected account loaded through lookup table');
  if (
    key('token_program').pubkey.toBase58() !== TOKEN_PROGRAM_ID.toBase58() ||
    key('token_2022_program').pubkey.toBase58() !==
      TOKEN_2022_PROGRAM_ID.toBase58()
  )
    reject('wrong token program');
  const args = decodeRouteData(Buffer.from(instruction.data));
  if (
    args.in_amount !== expected.rawInput ||
    !/^\d+$/.test(expected.maxInputRaw) ||
    BigInt(args.in_amount) < 1n ||
    BigInt(args.in_amount) > BigInt(expected.maxInputRaw) ||
    (expected.quotedOutputRaw !== undefined &&
      args.quoted_out_amount !== expected.quotedOutputRaw) ||
    (expected.quotedOutputRaw === undefined &&
      expected.minimumOutputRaw === undefined) ||
    !Number.isInteger(expected.maxSlippageBps) ||
    args.slippage_bps > expected.maxSlippageBps ||
    args.platform_fee_bps !== 0
  )
    reject('route amounts, slippage or fees differ from reviewed terms');
  if (
    expected.minimumOutputRaw !== undefined &&
    (!/^[1-9]\d*$/.test(expected.minimumOutputRaw) ||
      (BigInt(args.quoted_out_amount) * BigInt(10_000 - args.slippage_bps)) /
        10_000n <
        BigInt(expected.minimumOutputRaw))
  )
    reject('route output is below the reviewed minimum');
  return {
    createsDestinationAccount: creates.length === 1,
    rawInput: args.in_amount,
    quotedOutputRaw: args.quoted_out_amount,
    slippageBps: args.slippage_bps,
    lookupTableCount: tables.length,
    computeFeeCapLamports: fee.toString(),
  };
}
