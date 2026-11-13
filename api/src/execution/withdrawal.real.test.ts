import {
  Keypair,
  PublicKey,
  SystemInstruction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import {
  WithdrawalService,
  withdrawalAmount,
  type WithdrawalInput,
} from './withdrawal.service';
import { USDC_MINT } from '../config/constants';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
const sender = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const source = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), sender);
const stockMint = Keypair.generate().publicKey;

function fixture(asset: 'USDC' | 'SOL' | 'STOCK' = 'USDC') {
  let stockDecimals = 8;
  let scaleMultiplier: number | undefined;
  let programId = TOKEN_PROGRAM_ID;
  const mint = asset === 'STOCK' ? stockMint : new PublicKey(USDC_MINT);
  const input: WithdrawalInput = {
    wallet: sender.toBase58(),
    recipient: recipient.toBase58(),
    amount: '1.25',
    asset,
    requestId: 'fbfe79fa-c2af-4c39-a784-fd4573a7b716',
    ...(asset === 'STOCK' ? { mint: stockMint.toBase58() } : {}),
  };
  let balance = 100_000_000;
  let targetExists = false;
  const rpc = {
    call: jest.fn(async (method: string, params: unknown[]) => {
      await Promise.resolve();
      if (method === 'getBalance') return { value: balance };
      if (method === 'getAccountInfo')
        return {
          value:
            targetExists && params[0] !== recipient.toBase58()
              ? { owner: TOKEN_PROGRAM_ID.toBase58() }
              : null,
        };
      if (method === 'getLatestBlockhash')
        return {
          value: {
            blockhash: Keypair.generate().publicKey.toBase58(),
            lastValidBlockHeight: 200,
          },
        };
      if (method === 'getFeeForMessage') return { value: 5000 };
      if (method === 'getMinimumBalanceForRentExemption') return 2039280;
      if (method === 'getTokenAccountsByOwner')
        return {
          value: [
            {
              pubkey:
                asset === 'STOCK'
                  ? getAssociatedTokenAddressSync(
                      mint,
                      sender,
                      false,
                      programId,
                    ).toBase58()
                  : source.toBase58(),
              account: {
                owner: programId.toBase58(),
                data: {
                  parsed: {
                    info: {
                      owner: input.wallet,
                      mint: mint.toBase58(),
                      state: 'initialized',
                      tokenAmount:
                        asset === 'STOCK'
                          ? {
                              amount: String(2n * 10n ** BigInt(stockDecimals)),
                              decimals: stockDecimals,
                            }
                          : { amount: '2000000', decimals: 6 },
                    },
                  },
                },
              },
            },
          ],
        };
      throw new Error(`Unexpected RPC: ${method}`);
    }),
  };
  const auth = {
    requireSigner: jest
      .fn()
      .mockResolvedValue({ userId: 'user', walletId: 'embedded' }),
  };
  const approvals = {
    findReference: jest.fn().mockResolvedValue(undefined),
    pending: jest.fn().mockResolvedValue([]),
    create: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({
        ...row,
        id: 'approval',
        status: 'prepared',
      }),
    ),
  };
  const inspect = { inspect: jest.fn().mockResolvedValue('5000') };
  const stocks = {
    resolve: jest.fn(() =>
      Promise.resolve({
        mint: stockMint.toBase58(),
        symbol: 'TSLAx',
        ticker: 'TSLA',
        name: 'Tesla xStock',
        assetId: 'tesla',
        issuer: 'xStocks',
        decimals: stockDecimals,
        programId,
        accountSize: programId.equals(TOKEN_PROGRAM_ID) ? 165 : 170,
        scaleMultiplier,
      }),
    ),
  };
  const service = new WithdrawalService(
    auth as never,
    approvals as never,
    rpc as never,
    inspect as never,
    { SOLANA_NETWORK: 'mainnet' } as never,
    stocks as never,
  );
  return {
    service,
    input,
    auth,
    approvals,
    inspect,
    rpc,
    stocks,
    scaled: (multiplier: number) => {
      scaleMultiplier = multiplier;
      programId = TOKEN_2022_PROGRAM_ID;
    },
    stockPrecision: (decimals: number) => {
      stockDecimals = decimals;
    },
    token2022: () => {
      programId = TOKEN_2022_PROGRAM_ID;
    },
    setBalance: (value: number) => {
      balance = value;
    },
    targetExists: () => {
      targetExists = true;
    },
  };
}

function instructions(transaction: string) {
  const tx = VersionedTransaction.deserialize(
    Buffer.from(transaction, 'base64'),
  );
  return tx.message.compiledInstructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: tx.message.staticAccountKeys[ix.programIdIndex],
        keys: ix.accountKeyIndexes.map((index) => ({
          pubkey: tx.message.staticAccountKeys[index],
          isSigner: tx.message.isAccountSigner(index),
          isWritable: tx.message.isAccountWritable(index),
        })),
        data: Buffer.from(ix.data),
      }),
  );
}

describe('withdrawal transaction construction with real Solana libraries', () => {
  it('converts adjusted xStock shares into the exact underlying transfer units', async () => {
    const f = fixture('STOCK');
    f.scaled(2);
    f.input.amount = '1.25';
    const view = await f.service.prepare('Bearer token', f.input);
    const ixs = instructions(
      String(f.approvals.create.mock.calls[0][0].transaction),
    );
    expect(
      decodeTransferCheckedInstruction(ixs[1], TOKEN_2022_PROGRAM_ID).data
        .amount,
    ).toBe(62500000n);
    expect(view.details).toMatchObject({
      amount: '1.25',
      amountAtomic: '62500000',
      requestedAmount: '1.25',
      scaleMultiplier: '2',
    });
  });
  it('transfers the exact held stock mint and fractional shares, without converting to cash', async () => {
    const f = fixture('STOCK');
    f.input.amount = '0.12345678';
    const view = await f.service.prepare('Bearer token', f.input);
    const ixs = instructions(
      String(f.approvals.create.mock.calls[0][0].transaction),
    );
    expect(ixs).toHaveLength(2);
    const transfer = decodeTransferCheckedInstruction(ixs[1]);
    expect(transfer.data.amount).toBe(12345678n);
    expect(transfer.data.decimals).toBe(8);
    expect(transfer.keys.mint.pubkey.equals(stockMint)).toBe(true);
    expect(
      transfer.keys.destination.pubkey.equals(
        getAssociatedTokenAddressSync(stockMint, recipient),
      ),
    ).toBe(true);
    expect(view.details).toMatchObject({
      asset: 'STOCK',
      symbol: 'TSLAx',
      issuer: 'xStocks',
      mint: stockMint.toBase58(),
      amount: '0.12345678',
    });
  });

  it('uses the Token-2022 program, its ATA derivation and its receiving account rent', async () => {
    const f = fixture('STOCK');
    f.token2022();
    await f.service.prepare('Bearer token', f.input);
    const ixs = instructions(
      String(f.approvals.create.mock.calls[0][0].transaction),
    );
    const transfer = decodeTransferCheckedInstruction(
      ixs[1],
      TOKEN_2022_PROGRAM_ID,
    );
    expect(
      transfer.keys.destination.pubkey.equals(
        getAssociatedTokenAddressSync(
          stockMint,
          recipient,
          false,
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    ).toBe(true);
    expect(ixs[0].keys[5].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(f.rpc.call).toHaveBeenCalledWith(
      'getMinimumBalanceForRentExemption',
      [170, { commitment: 'confirmed' }],
    );
  });

  it('handles whole-share tokens and rejects fractions beyond the mint precision', async () => {
    const f = fixture('STOCK');
    f.stockPrecision(0);
    f.input.amount = '1';
    expect(
      (await f.service.prepare('Bearer token', f.input)).details.amount,
    ).toBe('1');
    f.input.amount = '0.1';
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'decimal places',
    );
  });

  it('cannot withdraw shares that are not available in the signing wallet', async () => {
    const f = fixture('STOCK');
    f.input.amount = '3';
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Insufficient available TSLAx',
    );
    expect(f.approvals.create).not.toHaveBeenCalled();
  });

  it('does not accept an unknown mint or an unprepared issuer transfer rule', async () => {
    const f = fixture('STOCK');
    f.stocks.resolve.mockRejectedValue(new Error('Unsupported stock'));
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Unsupported stock',
    );
    expect(f.approvals.create).not.toHaveBeenCalled();
    expect(f.inspect.inspect).not.toHaveBeenCalled();
  });
  it('transfers native USDC with exact decimals, recipient ATA and reviewed rent', async () => {
    const f = fixture();
    const view = await f.service.prepare('Bearer token', f.input);
    const row = f.approvals.create.mock.calls[0][0];
    const ixs = instructions(String(row.transaction));
    const transfer = decodeTransferCheckedInstruction(ixs[1]);
    expect(transfer.data.amount).toBe(1250000n);
    expect(transfer.data.decimals).toBe(6);
    expect(transfer.keys.owner.pubkey.equals(sender)).toBe(true);
    expect(transfer.keys.mint.pubkey.toBase58()).toBe(USDC_MINT);
    expect(
      transfer.keys.destination.pubkey.equals(
        getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), recipient),
      ),
    ).toBe(true);
    expect(ixs[0].data[0]).toBe(1); // Idempotent ATA creation.
    expect(view.details).toMatchObject({
      amount: '1.25',
      rentLamports: '2039280',
      recipient: f.input.recipient,
    });
    expect(f.inspect.inspect).toHaveBeenCalledWith(
      row.transaction,
      f.input.wallet,
    );
  });

  it('does not charge rent when the receiving token account exists', async () => {
    const f = fixture();
    f.targetExists();
    expect(
      (await f.service.prepare('Bearer token', f.input)).details.rentLamports,
    ).toBe('0');
  });

  it('constructs only the reviewed SOL transfer with exact lamports', async () => {
    const f = fixture('SOL');
    f.input.amount = '0.012345678';
    await f.service.prepare('Bearer token', f.input);
    const ixs = instructions(
      String(f.approvals.create.mock.calls[0][0].transaction),
    );
    expect(ixs).toHaveLength(1);
    const decoded = SystemInstruction.decodeTransfer(ixs[0]);
    expect(decoded.lamports).toBe(12345678n);
    expect(decoded.fromPubkey.equals(sender)).toBe(true);
    expect(decoded.toPubkey.equals(recipient)).toBe(true);
  });

  it.each(['0', '-1', '1e2', 'NaN', '1.0000001', ' 1', '18446744073710'])(
    'rejects invalid USDC amount %s',
    (amount) => {
      expect(() => withdrawalAmount(amount, 'USDC')).toThrow();
    },
  );

  it('keeps all nine SOL decimal places without floating point rounding', () => {
    expect(withdrawalAmount('123.000000001', 'SOL')).toBe(123000000001n);
  });

  it.each(['not-a-wallet', sender.toBase58()])(
    'rejects invalid and self recipients',
    async (address) => {
      const f = fixture();
      f.input.recipient = address;
      await expect(
        f.service.prepare('Bearer token', f.input),
      ).rejects.toThrow();
      expect(f.approvals.create).not.toHaveBeenCalled();
    },
  );

  it('requires wallet ownership before querying balances', async () => {
    const f = fixture();
    f.auth.requireSigner.mockRejectedValue(new Error('Not linked'));
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Not linked',
    );
    expect(f.rpc.call).not.toHaveBeenCalled();
  });

  it('rejects insufficient USDC without saving an approval', async () => {
    const f = fixture();
    f.input.amount = '3';
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Insufficient available USDC',
    );
    expect(f.approvals.create).not.toHaveBeenCalled();
  });

  it('requires SOL for both the receiving account and network fee', async () => {
    const f = fixture();
    f.setBalance(2039280);
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Insufficient SOL',
    );
    expect(f.approvals.create).not.toHaveBeenCalled();
  });

  it('reserves the SOL transaction fee rather than allowing a full-balance send', async () => {
    const f = fixture('SOL');
    f.input.amount = '0.1';
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Insufficient SOL',
    );
  });

  it('blocks a new withdrawal while another approval may still land', async () => {
    const f = fixture();
    f.approvals.pending.mockResolvedValue([{ id: 'pending' }]);
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'pending transaction',
    );
    expect(f.rpc.call).not.toHaveBeenCalled();
  });

  it('returns an identical request without rebuilding or signing', async () => {
    const f = fixture();
    f.approvals.findReference.mockResolvedValue({
      id: 'same',
      details: { asset: 'USDC', recipient: f.input.recipient, amount: '1.25' },
      expiresAt: new Date(),
      status: 'submitted',
    });
    expect((await f.service.prepare('Bearer token', f.input)).id).toBe('same');
    expect(f.rpc.call).not.toHaveBeenCalled();
    f.input.amount = '2';
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'another transfer',
    );
  });

  it('does not save a withdrawal that failed simulation', async () => {
    const f = fixture();
    f.inspect.inspect.mockRejectedValue(new Error('Simulation failed'));
    await expect(f.service.prepare('Bearer token', f.input)).rejects.toThrow(
      'Simulation failed',
    );
    expect(f.approvals.create).not.toHaveBeenCalled();
  });
});
