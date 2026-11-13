// The repo maps @solana/web3.js to a light mock for speed; this suite needs
// the real message compiler. rpc-websockets is ESM-only, stub it out.
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

import {
  ComputeBudgetProgram,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ALT_USED,
  STOCK,
  TITAN_PROGRAM,
  titanResponse,
  USDC,
  WALLET,
} from '../../test/titan.fixtures';
import { TitanError } from './titan.errors';
import { mapTitanQuoteToDomain } from './titan.mapper';
import {
  assertAllowedInstructions,
  ATA_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  inspectComputeBudget,
  MAX_PRIORITY_FEE_LAMPORTS,
  MEMO_PROGRAM_IDS,
  MIN_PRIORITY_MICRO_LAMPORTS,
  SYSTEM_PROGRAM_ID,
  TitanTxBuilder,
  TOKEN_PROGRAM_ID,
} from './titan-tx.builder';
import type { TitanInstruction, TitanRoutePayload } from './titan.types';

const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

function swapIx(): TitanInstruction {
  return {
    p: TITAN_PROGRAM,
    a: [
      { p: WALLET, s: true, w: true },
      // Both of these live in ALT_USED, so they should be table-loaded.
      { p: STOCK, s: false, w: true },
      { p: USDC, s: false, w: false },
    ],
    d: Buffer.from([7, 7, 7]).toString('base64'),
  };
}

function payloadWith(
  instructions: TitanInstruction[],
  opts: { inlineAlts?: boolean } = {},
): TitanRoutePayload {
  const response = titanResponse();
  response.quotes['Titan-DART'].instructions = instructions;
  if (opts.inlineAlts === false) response.alts = [];
  const quote = mapTitanQuoteToDomain({
    response,
    side: 'buy',
    assetId: 'tsla',
    ticker: 'TSLA',
    variant: { mint: STOCK, symbol: 'TSLAx', name: 'T', tradable: true },
    inputMint: USDC,
    outputMint: STOCK,
    inputSymbol: 'USDC',
    outputSymbol: 'TSLAx',
    inputDecimals: 6,
    outputDecimals: 8,
    amountUsd: 100,
    slippageBps: 50,
    amountRaw: '100000000',
    wallet: WALLET,
  });
  return quote.routePayload as TitanRoutePayload;
}

/** On-chain AddressLookupTable account bytes (56-byte meta + addresses). */
function serializedAlt(addresses: string[]): string {
  const meta = Buffer.alloc(56);
  meta.writeUInt32LE(1, 0); // LookupTable discriminator
  meta.writeBigUInt64LE(BigInt('18446744073709551615'), 4); // active
  return Buffer.concat([
    meta,
    ...addresses.map((a) => new PublicKey(a).toBuffer()),
  ]).toString('base64');
}

function rpcMock(
  fees: number[] = [5_000, 10_000, 20_000, 40_000],
  opts: { slot?: number; alt?: string | null } = {},
) {
  return {
    call: jest.fn((method: string) => {
      switch (method) {
        case 'getSlot':
          return Promise.resolve(opts.slot ?? 447_800_840);
        case 'getLatestBlockhash':
          return Promise.resolve({
            value: { blockhash: BLOCKHASH, lastValidBlockHeight: 123 },
          });
        case 'getRecentPrioritizationFees':
          return Promise.resolve(
            fees.map((prioritizationFee, slot) => ({
              slot,
              prioritizationFee,
            })),
          );
        case 'getMultipleAccounts':
          return Promise.resolve({
            value: [
              opts.alt === null
                ? null
                : {
                    data: [opts.alt ?? serializedAlt([STOCK, USDC]), 'base64'],
                  },
            ],
          });
        default:
          return Promise.reject(new Error(`unexpected ${method}`));
      }
    }),
  };
}

function decode(base64: string) {
  return VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
}

function programIds(tx: VersionedTransaction): string[] {
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.map((ix) =>
    keys[ix.programIdIndex].toBase58(),
  );
}

function asTitan(ix: {
  programId: PublicKey;
  data: Buffer | Uint8Array;
}): TitanInstruction {
  return {
    p: ix.programId.toBase58(),
    a: [],
    d: Buffer.from(ix.data).toString('base64'),
  };
}

function ix(
  p: string,
  data: number[],
  accounts: string[] = [],
): TitanInstruction {
  return {
    p,
    a: accounts.map((a) => ({ p: a, s: false, w: true })),
    d: Buffer.from(data).toString('base64'),
  };
}

const OTHER = 'Gx3JmvBNz5mRuqNkdwgvAWh9uRV3D8Xq5wRStUCpj3jC';

describe('TitanTxBuilder', () => {
  it('builds an unsigned v0 tx paid by the wallet, with our compute budget and on-chain ALTs', async () => {
    const rpc = rpcMock();
    const builder = new TitanTxBuilder(rpc as never);

    const built = await builder.build(payloadWith([swapIx()]), WALLET);
    const tx = decode(built.transaction);

    expect(tx.version).toBe(0);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(WALLET);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    expect(tx.message.recentBlockhash).toBe(BLOCKHASH);
    expect(programIds(tx)).toEqual([
      COMPUTE_BUDGET_PROGRAM_ID,
      COMPUTE_BUDGET_PROGRAM_ID,
      TITAN_PROGRAM,
    ]);
    expect(
      tx.message.addressTableLookups.map((l) => l.accountKey.toBase58()),
    ).toEqual([ALT_USED]);
    // STOCK (writable) and USDC (readonly) are resolved through the table.
    expect(tx.message.addressTableLookups[0].writableIndexes).toEqual([0]);
    expect(tx.message.addressTableLookups[0].readonlyIndexes).toEqual([1]);

    expect(built.computeUnitLimit).toBe(1_400_000);
    // p75 of [5k,10k,20k,40k] = 20k, capped so 1.4M CU never exceeds the max fee.
    const cap = Math.floor((MAX_PRIORITY_FEE_LAMPORTS * 1_000_000) / 1_400_000);
    expect(built.computeUnitPriceMicroLamports).toBe(Math.min(20_000, cap));
    expect(built.priorityFeeLamports).toBeLessThanOrEqual(
      MAX_PRIORITY_FEE_LAMPORTS,
    );
    expect(built.strippedComputeBudget).toBe(0);
    // Inline ALT contents from Titan are never trusted.
    expect(rpc.call).toHaveBeenCalledWith('getMultipleAccounts', [
      [ALT_USED],
      { encoding: 'base64', commitment: 'confirmed' },
    ]);
  });

  it('replaces Titan compute-budget instructions with our capped ones (H1/H2)', async () => {
    // Repro R4: Titan asks for 1e9 µL × 1.4M CU = 1.4 SOL priority fee.
    const limit = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000,
    });
    const price = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_000_000_000,
    });
    const instructions = [asTitan(limit), asTitan(price), swapIx()];
    expect(inspectComputeBudget(instructions)).toEqual({
      hasLimit: true,
      hasPrice: true,
    });

    const rpc = rpcMock([5_000_000_000]);
    const built = await new TitanTxBuilder(rpc as never).build(
      payloadWith(instructions),
      WALLET,
    );
    const tx = decode(built.transaction);
    expect(built.strippedComputeBudget).toBe(2);
    expect(programIds(tx)).toEqual([
      COMPUTE_BUDGET_PROGRAM_ID,
      COMPUTE_BUDGET_PROGRAM_ID,
      TITAN_PROGRAM,
    ]);
    // Total priority fee ≤ cap (0.001 SOL), never Titan's 1.4 SOL.
    expect(built.priorityFeeLamports).toBeLessThanOrEqual(
      MAX_PRIORITY_FEE_LAMPORTS,
    );
    const priceIx = tx.message.compiledInstructions[1];
    const encoded = Buffer.from(priceIx.data).readBigUInt64LE(1);
    expect(
      (Number(encoded) * built.computeUnitLimit) / 1_000_000,
    ).toBeLessThanOrEqual(MAX_PRIORITY_FEE_LAMPORTS);
  });

  it('caps the fee for a small CU limit too (R5: 0.007 SOL vs 0.001 cap)', async () => {
    const rpc = rpcMock([35_000_000]);
    const builder = new TitanTxBuilder(rpc as never);
    const price = await builder.priorityFee([], 200_000);
    expect((price * 200_000) / 1_000_000).toBeLessThanOrEqual(
      MAX_PRIORITY_FEE_LAMPORTS,
    );
  });

  it('refuses unknown ComputeBudget instructions', async () => {
    const rpc = rpcMock();
    await expect(
      new TitanTxBuilder(rpc as never).build(
        payloadWith([ix(COMPUTE_BUDGET_PROGRAM_ID, [9]), swapIx()]),
        WALLET,
      ),
    ).rejects.toMatchObject({ titanCode: 'disallowed_instruction' });
  });

  it('fails when a lookup table is missing on chain', async () => {
    const rpc = rpcMock(undefined, { alt: null });
    await expect(
      new TitanTxBuilder(rpc as never).build(payloadWith([swapIx()]), WALLET),
    ).rejects.toMatchObject({ titanCode: 'tx_build_failed' });
  });

  it('refuses a route past its expiresAfterSlot (stale_quote)', async () => {
    const payload = payloadWith([swapIx()]);
    payload.route.expiresAfterSlot = 447_800_841;
    const rpc = rpcMock(undefined, { slot: 447_800_840 });
    await expect(
      new TitanTxBuilder(rpc as never).build(payload, WALLET),
    ).rejects.toMatchObject({ titanCode: 'stale_quote' });

    payload.route.expiresAfterSlot = 447_800_900;
    const built = await new TitanTxBuilder(rpc as never).build(payload, WALLET);
    expect(built.expiresAfterSlot).toBe(447_800_900);
  });

  it('refuses routes built for another wallet', async () => {
    const builder = new TitanTxBuilder(rpcMock() as never);
    await expect(
      builder.build(payloadWith([swapIx()]), USDC),
    ).rejects.toMatchObject({ titanCode: 'wallet_mismatch' });
  });

  it('refuses routes that need a signer other than the wallet', async () => {
    const extra = swapIx();
    extra.a.push({ p: STOCK, s: true, w: false });
    const builder = new TitanTxBuilder(rpcMock() as never);
    await expect(
      builder.build(payloadWith([extra]), WALLET),
    ).rejects.toBeInstanceOf(TitanError);
  });

  it('falls back to the floor priority fee when the fee RPC fails', async () => {
    const rpc = {
      call: jest.fn(() => Promise.reject(new Error('rpc down'))),
    };
    const fee = await new TitanTxBuilder(rpc as never).priorityFee([], 200_000);
    expect(fee).toBe(MIN_PRIORITY_MICRO_LAMPORTS);
  });

  describe('program / instruction allowlist (H7)', () => {
    const allowed = (
      instructions: TitanInstruction[],
      extra: string[] = [],
    ) => {
      try {
        assertAllowedInstructions(
          instructions,
          WALLET,
          new Set([TITAN_PROGRAM, ...extra]),
        );
        return 'ok';
      } catch (err) {
        return (err as TitanError).titanCode;
      }
    };

    it('allows the Titan swap program, memo and heap-frame requests', () => {
      expect(
        allowed([
          swapIx(),
          ix(MEMO_PROGRAM_IDS[0], [1, 2]),
          ix(COMPUTE_BUDGET_PROGRAM_ID, [1, 0, 0, 1, 0]),
        ]),
      ).toBe('ok');
    });

    it('rejects unknown programs unless explicitly configured', () => {
      expect(allowed([ix(OTHER, [1])])).toBe('disallowed_instruction');
      expect(allowed([ix(OTHER, [1])], [OTHER])).toBe('ok');
    });

    it('rejects System program transfers', () => {
      expect(
        allowed([ix(SYSTEM_PROGRAM_ID, [2, 0, 0, 0], [WALLET, OTHER])]),
      ).toBe('disallowed_instruction');
    });

    it('allows wallet-owned ATA creation only', () => {
      const ata = (funder: string, owner: string) =>
        ix(ATA_PROGRAM_ID, [1], [funder, OTHER, owner, STOCK]);
      expect(allowed([ata(WALLET, WALLET)])).toBe('ok');
      expect(allowed([ata(WALLET, OTHER)])).toBe('disallowed_instruction');
      expect(allowed([ix(ATA_PROGRAM_ID, [2], [WALLET, OTHER, WALLET])])).toBe(
        'disallowed_instruction',
      );
    });

    it('allows SyncNative and CloseAccount back to the wallet only', () => {
      expect(allowed([ix(TOKEN_PROGRAM_ID, [17], [OTHER])])).toBe('ok');
      expect(
        allowed([ix(TOKEN_PROGRAM_ID, [9], [OTHER, WALLET, WALLET])]),
      ).toBe('ok');
      expect(allowed([ix(TOKEN_PROGRAM_ID, [9], [OTHER, OTHER, WALLET])])).toBe(
        'disallowed_instruction',
      );
      // Transfer / Approve / SetAuthority are never allowed.
      for (const tag of [3, 4, 6, 12]) {
        expect(allowed([ix(TOKEN_PROGRAM_ID, [tag], [OTHER])])).toBe(
          'disallowed_instruction',
        );
      }
    });

    it('build() rejects a route with a disallowed instruction', async () => {
      const builder = new TitanTxBuilder(rpcMock() as never);
      await expect(
        builder.build(
          payloadWith([
            swapIx(),
            ix(TOKEN_PROGRAM_ID, [3], [OTHER, OTHER, WALLET]),
          ]),
          WALLET,
        ),
      ).rejects.toMatchObject({ titanCode: 'disallowed_instruction' });
    });

    it('honours TITAN_EXTRA_PROGRAM_IDS from env', async () => {
      const builder = new TitanTxBuilder(rpcMock() as never, {
        TITAN_EXTRA_PROGRAM_IDS: [OTHER],
      });
      const built = await builder.build(
        payloadWith([swapIx(), ix(OTHER, [1], [STOCK])]),
        WALLET,
      );
      expect(programIds(decode(built.transaction))).toContain(OTHER);
    });
  });
});
