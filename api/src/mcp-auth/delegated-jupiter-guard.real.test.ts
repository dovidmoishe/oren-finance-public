import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  MintLayout,
  MINT_SIZE,
} from '@solana/spl-token';
import { inspectDelegatedJupiterTransaction } from './delegated-jupiter-guard';
import { staticJupiterAccounts } from '../signer-gate/static-jupiter-accounts';
import { inspectApiTradeTransaction } from './api-trade-transaction';
import { buildGateJupiterRoute } from '../signer-gate/gate-jupiter';
import type { mcpTradeIntents } from '../database/schema';
import { rawSellShares } from './delegated-amounts';

const JUPITER = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const STOCK = new PublicKey('TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S');
const wallet = Keypair.generate().publicKey;
const sourceAta = getAssociatedTokenAddressSync(USDC, wallet);
const destinationAta = getAssociatedTokenAddressSync(
  STOCK,
  wallet,
  false,
  TOKEN_2022_PROGRAM_ID,
);
const random = () => Keypair.generate().publicKey;
const expected = {
  wallet: wallet.toBase58(),
  inputMint: USDC.toBase58(),
  outputMint: STOCK.toBase58(),
  sourceAta: sourceAta.toBase58(),
  destinationAta: destinationAta.toBase58(),
  rawInput: '1000000',
  quotedOutputRaw: '10000',
  maxInputRaw: '1000000',
  maxSlippageBps: 50,
};

function route(amount = 1_000_000n, overrides: Record<number, PublicKey> = {}) {
  const data = Buffer.alloc(8 + 1 + 4 + 8 + 8 + 2 + 1);
  Buffer.from('c1209b3341d69c81', 'hex').copy(data);
  data[8] = 0;
  data.writeUInt32LE(0, 9);
  data.writeBigUInt64LE(amount, 13);
  data.writeBigUInt64LE(10_000n, 21);
  data.writeUInt16LE(50, 29);
  const addresses = [
    TOKEN_PROGRAM_ID,
    random(),
    wallet,
    sourceAta,
    random(),
    random(),
    destinationAta,
    USDC,
    STOCK,
    random(),
    TOKEN_2022_PROGRAM_ID,
    random(),
    JUPITER,
  ];
  return new TransactionInstruction({
    programId: JUPITER,
    data,
    keys: addresses.map((pubkey, index) => ({
      pubkey: overrides[index] ?? pubkey,
      isSigner: index === 2,
      isWritable: index === 3 || index === 6,
    })),
  });
}

function transaction(
  instructions: TransactionInstruction[],
  tables: AddressLookupTableAccount[] = [],
) {
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: random().toBase58(),
    instructions,
  }).compileToV0Message(tables);
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64',
  );
}

const noTable = () => Promise.resolve(null);

function apiFixture(decimals = 6) {
  const intent = {
    id: 'fixture',
    side: 'buy',
    wallet: expected.wallet,
    assetId: 'stock',
    stockMint: STOCK.toBase58(),
    maxInRaw: '1000000',
    minOutRaw: '9950',
    amountUsd: '1.000000',
    amountShares: null,
    slippageBps: 50,
    mode: 'delegated',
    status: 'prepared',
    expiresAt: new Date(Date.now() + 300000),
  } as typeof mcpTradeIntents.$inferSelect;
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 100000000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    mintData,
  );
  const inspect = jest.fn().mockResolvedValue('5000');
  const deps = {
    connection: {
      getAccountInfo: jest
        .fn()
        .mockResolvedValue({ owner: TOKEN_2022_PROGRAM_ID, data: mintData }),
      getAddressLookupTable: jest.fn().mockResolvedValue({ value: null }),
    },
    tokens: {
      getStock: jest.fn().mockResolvedValue({
        id: 'stock',
        price: 25,
        variants: [{ mint: STOCK.toBase58(), tradable: true }],
      }),
    },
    rpc: { inspect },
  };
  const check = (tx = transaction([route()])) =>
    inspectApiTradeTransaction(tx, intent, deps as never);
  return { intent, deps, check };
}

describe('independent API transaction validation with real Solana serialization', () => {
  it('accepts a bounded route and charges the actual raw USDC', async () => {
    const f = apiFixture();
    await expect(f.check()).resolves.toBe('1.000000');
    expect(f.deps.rpc.inspect).toHaveBeenCalledWith(
      expect.any(String),
      expected.wallet,
      {
        inputMint: expected.inputMint,
        outputMint: expected.outputMint,
        maxInRaw: '1000000',
        minOutRaw: '9950',
      },
    );
  });
  it('rejects the original understated-dollar exploit in both signing components', async () => {
    const f = apiFixture();
    f.intent.amountUsd = '0.010000';
    await expect(f.check()).rejects.toThrow('raw USDC');
    await expect(buildGateJupiterRoute(f.intent, {} as never)).rejects.toThrow(
      'raw USDC',
    );
    expect(f.deps.rpc.inspect).not.toHaveBeenCalled();
  });
  it('rejects wrong destination, oversized input, a second route and bundled transfer', async () => {
    const f = apiFixture();
    for (const instructions of [
      [route(1000000n, { 6: random() })],
      [route(1000001n)],
      [route(), route()],
      [
        route(),
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: random(),
          lamports: 1,
        }),
      ],
    ])
      await expect(f.check(transaction(instructions))).rejects.toThrow();
    expect(f.deps.rpc.inspect).not.toHaveBeenCalled();
  });
  it('checks the encoded output floor independently of gate quote metadata', async () => {
    const f = apiFixture();
    const altered = route();
    altered.data.writeBigUInt64LE(9999n, 21);
    await expect(f.check(transaction([altered]))).rejects.toThrow(
      'reviewed minimum',
    );
    f.deps.rpc.inspect.mockRejectedValueOnce(new Error('simulation failed'));
    await expect(f.check()).rejects.toThrow('simulation failed');
  });
  it('derives sell reference value from mint decimals and rejects understated shares', async () => {
    const f = apiFixture();
    f.intent.side = 'sell';
    f.intent.amountUsd = null;
    f.intent.amountShares = '1.000000000000';
    const stockSource = getAssociatedTokenAddressSync(
      STOCK,
      wallet,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const usdcDestination = getAssociatedTokenAddressSync(USDC, wallet);
    const tx = transaction([
      route(1000000n, {
        3: stockSource,
        6: usdcDestination,
        7: STOCK,
        8: USDC,
      }),
    ]);
    await expect(f.check(tx)).resolves.toBe('25.000000');
    f.intent.amountShares = '0.010000000000';
    await expect(f.check(tx)).rejects.toThrow('differs from raw');
  });
  it('both signing components accept normalized eight-decimal sells and still reject mismatches', async () => {
    const f = apiFixture(8);
    Object.assign(f.intent, {
      side: 'sell',
      amountUsd: null,
      maxInRaw: '12345679',
      amountShares: rawSellShares('12345679', 8),
    });
    const source = getAssociatedTokenAddressSync(
      STOCK,
      wallet,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const destination = getAssociatedTokenAddressSync(USDC, wallet);
    const tx = transaction([
      route(12345679n, { 3: source, 6: destination, 7: STOCK, 8: USDC }),
    ]);
    const deps = {
      ...f.deps,
      jupiter: {
        getQuote: jest.fn().mockResolvedValue({
          inputMint: STOCK.toBase58(),
          outputMint: USDC.toBase58(),
          inAmount: '12345679',
          outAmount: '10000',
          otherAmountThreshold: '9950',
          swapMode: 'ExactIn',
          slippageBps: 50,
        }),
        postSwap: jest.fn().mockResolvedValue({ swapTransaction: tx }),
      },
    };
    await expect(f.check(tx)).resolves.toBe('3.086420');
    await expect(
      buildGateJupiterRoute(f.intent, deps as never),
    ).resolves.toMatchObject({
      rawInput: '12345679',
      referenceValueUsd: '3.086420',
    });
    f.intent.amountShares = '0.123456789000';
    await expect(f.check(tx)).rejects.toThrow('differs from raw');
    await expect(
      buildGateJupiterRoute(f.intent, deps as never),
    ).rejects.toThrow('differs from raw');
  });
});

describe('delegated Jupiter transaction guard', () => {
  it('accepts one bounded route with protected static accounts', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route()]),
        expected,
        noTable,
      ),
    ).resolves.toMatchObject({ rawInput: '1000000', lookupTableCount: 0 });
  });

  it('rejects two individually valid routes before any signing', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route(), route()]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('exactly one Jupiter route');
  });

  it('rejects an added transfer and over-cap input', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([
          route(),
          SystemProgram.transfer({
            fromPubkey: wallet,
            toPubkey: random(),
            lamports: 1,
          }),
        ]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('unapproved top-level instruction');
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route(1_000_001n)]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('route amounts');
  });

  it('rejects changed protected accounts and ALT-loaded mints', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route(1_000_000n, { 6: random() })]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('wrong destination_token_account');
    const table = new AddressLookupTableAccount({
      key: random(),
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [USDC, STOCK],
      },
    });
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([route()], [table]),
        expected,
        () => Promise.resolve(table),
      ),
    ).rejects.toThrow('protected account loaded through lookup table');
  });

  it('moves protected ALT accounts to static keys without changing the route', async () => {
    const instruction = route();
    const table = new AddressLookupTableAccount({
      key: random(),
      state: {
        deactivationSlot: BigInt('18446744073709551615'),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [
          USDC,
          STOCK,
          sourceAta,
          destinationAta,
          instruction.keys[1].pubkey,
        ],
      },
    });
    const original = transaction([instruction], [table]);
    const rewritten = await staticJupiterAccounts(
      original,
      new Set([
        expected.wallet,
        expected.inputMint,
        expected.outputMint,
        expected.sourceAta,
        expected.destinationAta,
      ]),
      () => Promise.resolve(table),
    );
    expect(rewritten).not.toBe(original);
    await expect(
      inspectDelegatedJupiterTransaction(rewritten, expected, () =>
        Promise.resolve(table),
      ),
    ).resolves.toMatchObject({ rawInput: '1000000', lookupTableCount: 1 });
    const repeatedRoute = await staticJupiterAccounts(
      transaction([route(), route()], [table]),
      new Set([
        expected.wallet,
        expected.inputMint,
        expected.outputMint,
        expected.sourceAta,
        expected.destinationAta,
      ]),
      () => Promise.resolve(table),
    );
    await expect(
      inspectDelegatedJupiterTransaction(repeatedRoute, expected, () =>
        Promise.resolve(table),
      ),
    ).rejects.toThrow('exactly one Jupiter route');
  });

  it('rejects priority fees above the delegated allowance', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 1_000_000,
          }),
          route(),
        ]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('priority fee over cap');
  });

  it('rejects trailing data that could hide different decoded amounts', async () => {
    const altered = route();
    altered.data = Buffer.concat([altered.data, Buffer.from([0])]);
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([altered]),
        expected,
        noTable,
      ),
    ).rejects.toThrow('trailing route data');
  });
});

function createDestination(program = TOKEN_2022_PROGRAM_ID, mint = STOCK) {
  return createAssociatedTokenAccountIdempotentInstruction(
    wallet,
    getAssociatedTokenAddressSync(mint, wallet, false, program),
    wallet,
    mint,
    program,
  );
}

const creationTerms = {
  ...expected,
  destinationTokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
  requireDestinationAccountCreation: true,
};

describe('headless first-purchase account creation', () => {
  it('rejects an implicit multi-instruction compute budget and enforces the explicit fee cap', async () => {
    const price = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 500000,
    });
    const implicit = transaction([price, createDestination(), route()]);
    await expect(
      inspectDelegatedJupiterTransaction(implicit, creationTerms, noTable),
    ).rejects.toThrow('explicit compute unit limit');
    const f = apiFixture();
    await expect(f.check(implicit)).rejects.toThrow(
      'explicit compute unit limit',
    );
    expect(f.deps.rpc.inspect).not.toHaveBeenCalled();
    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      price,
      createDestination(),
      route(),
    ];
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction(instructions),
        creationTerms,
        noTable,
      ),
    ).rejects.toThrow('priority fee over cap');
    instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 250000,
    });
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction(instructions),
        creationTerms,
        noTable,
      ),
    ).resolves.toMatchObject({ computeFeeCapLamports: '100000' });
  });

  it('both cosigners accept missing USDC destination creation on a sell', async () => {
    const f = apiFixture();
    Object.assign(f.intent, {
      side: 'sell',
      amountUsd: null,
      amountShares: '1.000000000000',
    });
    const mintAccount = (await f.deps.connection.getAccountInfo()) as {
      owner: PublicKey;
      data: Buffer;
    };
    f.deps.connection.getAccountInfo.mockImplementation((key: PublicKey) =>
      Promise.resolve(key.equals(sourceAta) ? null : mintAccount),
    );
    const tx = transaction([
      createDestination(TOKEN_PROGRAM_ID, USDC),
      route(1000000n, { 3: destinationAta, 6: sourceAta, 7: STOCK, 8: USDC }),
    ]);
    const deps = {
      ...f.deps,
      jupiter: {
        getQuote: jest.fn().mockResolvedValue({
          inputMint: STOCK.toBase58(),
          outputMint: USDC.toBase58(),
          inAmount: '1000000',
          outAmount: '10000',
          otherAmountThreshold: '9950',
          swapMode: 'ExactIn',
          slippageBps: 50,
        }),
        postSwap: jest.fn().mockResolvedValue({ swapTransaction: tx }),
      },
    };
    await expect(f.check(tx)).resolves.toBe('25.000000');
    await expect(
      buildGateJupiterRoute(f.intent, deps as never),
    ).resolves.toMatchObject({ rawInput: '1000000' });
  });

  it.each([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])(
    'accepts an exact idempotent destination for program %s',
    async (program) => {
      const destination = getAssociatedTokenAddressSync(
        STOCK,
        wallet,
        false,
        program,
      );
      await expect(
        inspectDelegatedJupiterTransaction(
          transaction([
            createDestination(program),
            route(1000000n, { 6: destination }),
          ]),
          {
            ...creationTerms,
            destinationAta: destination.toBase58(),
            destinationTokenProgram: program.toBase58(),
          },
          noTable,
        ),
      ).resolves.toMatchObject({ rawInput: '1000000' });
    },
  );

  it('allows idempotent creation when the account already exists', async () => {
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([createDestination(), route()]),
        { ...creationTerms, requireDestinationAccountCreation: false },
        noTable,
      ),
    ).resolves.toMatchObject({ rawInput: '1000000' });
  });

  it('rejects missing, duplicate, late and unverified creation', async () => {
    for (const instructions of [
      [route()],
      [createDestination(), createDestination(), route()],
      [route(), createDestination()],
    ]) {
      await expect(
        inspectDelegatedJupiterTransaction(
          transaction(instructions),
          creationTerms,
          noTable,
        ),
      ).rejects.toThrow();
    }
    await expect(
      inspectDelegatedJupiterTransaction(
        transaction([createDestination(), route()]),
        expected,
        noTable,
      ),
    ).rejects.toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'rejects substituted ATA account %s in both cosigners',
    async (index) => {
      const create = createDestination();
      // A substituted payer is not an authorized additional transaction signer.
      create.keys[index] = {
        ...create.keys[index],
        pubkey: random(),
        isSigner: false,
      };
      const tx = transaction([create, route()]);
      await expect(
        inspectDelegatedJupiterTransaction(tx, creationTerms, noTable),
      ).rejects.toThrow();
      const f = apiFixture();
      await expect(f.check(tx)).rejects.toThrow();
      expect(f.deps.rpc.inspect).not.toHaveBeenCalled();
    },
  );

  it.each([
    Buffer.alloc(0),
    Buffer.from([0]),
    Buffer.from([2]),
    Buffer.from([1, 0]),
  ])(
    'rejects non-idempotent, nested-recovery and trailing instruction data %s',
    async (data) => {
      const create = createDestination();
      create.data = data;
      await expect(
        inspectDelegatedJupiterTransaction(
          transaction([create, route()]),
          creationTerms,
          noTable,
        ),
      ).rejects.toThrow();
    },
  );

  it('rejects source-account creation and an extra SOL transfer', async () => {
    const source = createDestination(TOKEN_PROGRAM_ID, USDC);
    for (const instructions of [
      [source, route()],
      [
        createDestination(),
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: random(),
          lamports: 1,
        }),
        route(),
      ],
    ]) {
      await expect(
        inspectDelegatedJupiterTransaction(
          transaction(instructions),
          creationTerms,
          noTable,
        ),
      ).rejects.toThrow();
    }
  });

  it('requires protected creation accounts to be static and preserves them when recompiling', async () => {
    const create = createDestination();
    const table = new AddressLookupTableAccount({
      key: random(),
      state: {
        deactivationSlot: 18446744073709551615n,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [SystemProgram.programId, TOKEN_2022_PROGRAM_ID],
      },
    });
    const tx = transaction([create, route()], [table]);
    await expect(
      inspectDelegatedJupiterTransaction(tx, creationTerms, () =>
        Promise.resolve(table),
      ),
    ).rejects.toThrow('creation accounts');
    const rewritten = await staticJupiterAccounts(
      tx,
      new Set([
        ...Object.values(expected).filter((v) => typeof v === 'string'),
        ...create.keys.map((k) => k.pubkey.toBase58()),
        create.programId.toBase58(),
      ]),
      () => Promise.resolve(table),
    );
    await expect(
      inspectDelegatedJupiterTransaction(rewritten, creationTerms, () =>
        Promise.resolve(table),
      ),
    ).resolves.toMatchObject({ rawInput: '1000000' });
  });

  it('both cosigners accept a first buy with no destination; missing source and omitted creation fail before signing', async () => {
    const f = apiFixture();
    const getAccount = f.deps.connection.getAccountInfo;
    const mintAccount = {
      owner: TOKEN_2022_PROGRAM_ID,
      data: Buffer.alloc(MINT_SIZE),
    };
    getAccount.mockImplementation((key: PublicKey) =>
      Promise.resolve(key.equals(destinationAta) ? null : mintAccount),
    );
    const tx = transaction([createDestination(), route()]);
    const deps = {
      ...f.deps,
      jupiter: {
        getQuote: jest.fn().mockResolvedValue({
          inputMint: expected.inputMint,
          outputMint: expected.outputMint,
          inAmount: '1000000',
          outAmount: '10000',
          otherAmountThreshold: '9950',
          swapMode: 'ExactIn',
          slippageBps: 50,
        }),
        postSwap: jest.fn().mockResolvedValue({ swapTransaction: tx }),
      },
    };
    await expect(f.check(tx)).resolves.toBe('1.000000');
    await expect(
      buildGateJupiterRoute(f.intent, deps as never),
    ).resolves.toMatchObject({ rawInput: '1000000' });
    deps.jupiter.postSwap.mockResolvedValue({
      swapTransaction: transaction([route()]),
    });
    await expect(
      buildGateJupiterRoute(f.intent, deps as never),
    ).rejects.toThrow('missing destination account creation');
    getAccount.mockImplementation((key: PublicKey) =>
      Promise.resolve(key.equals(sourceAta) ? null : mintAccount),
    );
    await expect(
      buildGateJupiterRoute(f.intent, deps as never),
    ).rejects.toThrow('existing source');
  });

  it('the independent API still requires simulation and the original output floor', async () => {
    const f = apiFixture();
    f.deps.rpc.inspect.mockRejectedValue(new Error('insufficient rent'));
    await expect(
      f.check(transaction([createDestination(), route()])),
    ).rejects.toThrow('insufficient rent');
    const changed = route();
    changed.data.writeBigUInt64LE(9999n, 21);
    await expect(
      f.check(transaction([createDestination(), changed])),
    ).rejects.toThrow('reviewed minimum');
  });
});
