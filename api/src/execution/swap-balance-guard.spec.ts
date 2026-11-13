// Needs the real PublicKey (PDA derivation) and VersionedTransaction.
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
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ApprovalRpc } from './approval-rpc.service';
import {
  associatedTokenAddresses,
  checkSimulatedBalances,
  MAX_SWAP_NETWORK_FEE_LAMPORTS,
  NATIVE_SOL_MINT,
  probeBalances,
  RENT_ALLOWANCE_LAMPORTS,
  simulationAddresses,
  type SimulatedAccount,
  tokenAmount,
} from './swap-balance-guard';
import type { SwapExpectation } from './swap-terms';
import { STOCK, USDC, WALLET } from '../test/titan.fixtures';
import { JUPITER_V6_PROGRAM, TITAN_SWAP_PROGRAM } from './simulation-reason';

const USDC_ACCOUNT = Keypair.generate().publicKey.toBase58();

function tokenAccount(amount: bigint): SimulatedAccount {
  const data = Buffer.alloc(165);
  data.writeBigUInt64LE(amount, 64);
  return { data: [data.toString('base64'), 'base64'], lamports: 2_039_280 };
}

const buy: SwapExpectation = {
  inputMint: USDC,
  outputMint: STOCK,
  maxInRaw: '100000000',
  minOutRaw: '398000000',
};

/**
 * Fake RPC: the wallet holds 150 USDC in a non-ATA account and no stock.
 * `post` describes the simulated state after the swap.
 */
function fakeRpc(post: {
  usdc: bigint;
  stock: bigint | null;
  lamports: number;
  fee?: number;
  err?: unknown;
}) {
  const stockAtas = associatedTokenAddresses(WALLET, STOCK);
  return {
    call: jest.fn((method: string, params: unknown[]) => {
      switch (method) {
        case 'getTokenAccountsByOwner': {
          const { mint } = params[1] as { mint: string };
          return Promise.resolve({
            value:
              mint === USDC
                ? [
                    {
                      pubkey: USDC_ACCOUNT,
                      account: tokenAccount(150_000_000n),
                    },
                  ]
                : [],
          });
        }
        case 'getBalance':
          return Promise.resolve({ value: 1_000_000_000 });
        case 'getFeeForMessage':
          return Promise.resolve({ value: post.fee ?? 5_000 });
        case 'simulateTransaction': {
          const opts = params[1] as {
            accounts?: { addresses: string[] };
          };
          const accounts = (opts.accounts?.addresses ?? []).map((address) => {
            if (address === WALLET) return { lamports: post.lamports };
            if (address === USDC_ACCOUNT) return tokenAccount(post.usdc);
            if (address === stockAtas[0] && post.stock !== null)
              return tokenAccount(post.stock);
            return null;
          });
          return Promise.resolve({
            value: { err: post.err ?? null, accounts },
          });
        }
        default:
          return Promise.reject(new Error(`unexpected ${method}`));
      }
    }),
  };
}

function walletTx(program = STOCK): string {
  const message = new TransactionMessage({
    payerKey: new PublicKey(WALLET),
    recentBlockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
    instructions: [
      new TransactionInstruction({
        programId: new PublicKey(program),
        keys: [],
        data: Buffer.from([1]),
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64',
  );
}

describe('swap balance guard', () => {
  it('reads raw token amounts at offset 64 and treats missing accounts as 0', () => {
    expect(tokenAmount(tokenAccount(123n))).toBe(123n);
    expect(tokenAmount(null)).toBe(0n);
  });

  it('includes the derived ATAs for both token programs', async () => {
    const rpc = fakeRpc({ usdc: 50_000_000n, stock: 0n, lamports: 0 });
    const probe = await probeBalances(rpc as never, WALLET, buy);
    const atas = associatedTokenAddresses(WALLET, STOCK);
    expect(probe.outputAccounts).toEqual(expect.arrayContaining(atas));
    expect(probe.inputAccounts).toContain(USDC_ACCOUNT);
    expect(simulationAddresses(probe)[0]).toBe(WALLET);
  });

  it('passes when the wallet receives at least the reviewed minimum', async () => {
    const rpc = fakeRpc({
      usdc: 50_000_000n,
      stock: 398_000_000n,
      lamports: 1_000_000_000 - 5_000 - 2_039_280,
    });
    const probe = await probeBalances(rpc as never, WALLET, buy);
    const addresses = simulationAddresses(probe);
    const sim = await rpc.call('simulateTransaction', [
      'tx',
      { accounts: { addresses } },
    ]);
    const result = checkSimulatedBalances(
      probe,
      buy,
      addresses,
      (sim as { value: { accounts: SimulatedAccount[] } }).value.accounts,
      5_000n,
    );
    expect(result).toMatchObject({
      ok: true,
      outReceivedRaw: 398_000_000n,
      inSpentRaw: 100_000_000n,
    });
  });

  const check = async (post: Parameters<typeof fakeRpc>[0], exp = buy) => {
    const rpc = fakeRpc(post);
    const probe = await probeBalances(rpc as never, WALLET, exp);
    const addresses = simulationAddresses(probe);
    const sim = (await rpc.call('simulateTransaction', [
      'tx',
      { accounts: { addresses } },
    ])) as { value: { accounts: SimulatedAccount[] } };
    return checkSimulatedBalances(
      probe,
      exp,
      addresses,
      sim.value.accounts,
      BigInt(post.fee ?? 5_000),
    );
  };

  it('fails when the simulated output is below the reviewed minimum', async () => {
    const result = await check({
      usdc: 50_000_000n,
      stock: 397_999_999n,
      lamports: 999_995_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('below the reviewed minimum');
  });

  it('fails when more input than reviewed is spent', async () => {
    const result = await check({
      usdc: 40_000_000n,
      stock: 400_000_000n,
      lamports: 999_995_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('input spent');
  });

  it('fails when SOL leaves the wallet beyond fee + rent (drain)', async () => {
    const result = await check({
      usdc: 50_000_000n,
      stock: 400_000_000n,
      lamports: 1_000_000_000 - 5_000 - RENT_ALLOWANCE_LAMPORTS - 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('SOL outflow');
  });

  it('fails when the network fee is above the swap fee cap', async () => {
    const result = await check({
      usdc: 50_000_000n,
      stock: 400_000_000n,
      lamports: 1_000_000_000 - MAX_SWAP_NETWORK_FEE_LAMPORTS - 1,
      fee: MAX_SWAP_NETWORK_FEE_LAMPORTS + 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('fee');
  });

  it('checks the lamport increase for native SOL output', async () => {
    const sell: SwapExpectation = {
      inputMint: USDC,
      outputMint: NATIVE_SOL_MINT,
      maxInRaw: '100000000',
      minOutRaw: '500000000',
    };
    const ok = await check(
      { usdc: 50_000_000n, stock: null, lamports: 1_500_000_000 - 5_000 },
      sell,
    );
    expect(ok.ok).toBe(true);
    const short = await check(
      { usdc: 50_000_000n, stock: null, lamports: 1_100_000_000 },
      sell,
    );
    expect(short.ok).toBe(false);
  });
});

describe('ApprovalRpc.inspect with an expectation', () => {
  it.each([
    [
      { InsufficientFundsForRent: { account_index: 0 } },
      'INSUFFICIENT_SOL_FOR_RENT',
    ],
    ['InsufficientFundsForFee', 'INSUFFICIENT_SOL_FOR_FEES'],
  ])(
    'identifies SOL funding failures without blaming USDC or RPC availability',
    async (err, code) => {
      const rpc = fakeRpc({
        usdc: 50000000n,
        stock: null,
        lamports: 1750880,
        err,
      });
      const service = new ApprovalRpc(rpc as never);
      try {
        await service.inspect(walletTx(), WALLET, buy);
        throw new Error('expected rejection');
      } catch (error) {
        expect(
          (error as { getResponse: () => unknown }).getResponse(),
        ).toMatchObject({ code });
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('SOL');
      }
    },
  );

  it('simulates with the touched accounts and returns the fee when terms hold', async () => {
    const rpc = fakeRpc({
      usdc: 50_000_000n,
      stock: 399_000_000n,
      lamports: 999_995_000,
    });
    const service = new ApprovalRpc(rpc as never);
    await expect(service.inspect(walletTx(), WALLET, buy)).resolves.toBe(
      '5000',
    );
    const simulate = rpc.call.mock.calls.find(
      ([method]) => method === 'simulateTransaction',
    ) as [string, unknown[]];
    expect(simulate[1][1]).toMatchObject({
      sigVerify: false,
      accounts: { encoding: 'base64' },
    });
  });

  it('refuses to approve when the simulated output is below the reviewed minimum', async () => {
    const rpc = fakeRpc({
      usdc: 50_000_000n,
      stock: 1n,
      lamports: 999_995_000,
    });
    const service = new ApprovalRpc(rpc as never);
    await expect(service.inspect(walletTx(), WALLET, buy)).rejects.toThrow(
      'no longer matches the terms you reviewed',
    );
  });

  it('names Jupiter 6001 and Titan minimum-out as slippage, not a generic failure', async () => {
    for (const [program, code] of [
      [JUPITER_V6_PROGRAM, 6001],
      [TITAN_SWAP_PROGRAM, 6008],
    ] as const) {
      const rpc = fakeRpc({
        usdc: 0n,
        stock: null,
        lamports: 0,
        err: { InstructionError: [0, { Custom: code }] },
      });
      const service = new ApprovalRpc(rpc as never);
      try {
        await service.inspect(walletTx(program), WALLET);
        throw new Error('expected rejection');
      } catch (error) {
        expect(
          (
            error as { getResponse: () => { code?: string; message?: string } }
          ).getResponse(),
        ).toMatchObject({
          code: 'QUOTE_SLIPPAGE_EXCEEDED',
        });
        expect((error as Error).message).toContain('slippage limit');
        expect((error as Error).message).not.toMatch(
          /signing grant|signing permission/i,
        );
      }
    }
  });

  it('keeps the plain simulation for non-swap approvals', async () => {
    const rpc = fakeRpc({ usdc: 0n, stock: null, lamports: 0 });
    const service = new ApprovalRpc(rpc as never);
    await expect(service.inspect(walletTx(), WALLET)).resolves.toBe('5000');
    expect(rpc.call).not.toHaveBeenCalledWith(
      'getTokenAccountsByOwner',
      expect.anything(),
    );
  });
});
