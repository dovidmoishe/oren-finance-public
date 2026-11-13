import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import {
  AccountType,
  ExtensionType,
  getMintLen,
  getTypeLen,
  MINT_SIZE,
  MintLayout,
  ScaledUiAmountConfigLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { WithdrawalStocksService } from './withdrawal-stocks.service';

const mint = Keypair.generate().publicKey;
const wallet = Keypair.generate().publicKey;
const otherMint = Keypair.generate().publicKey;
function fixture() {
  let program = TOKEN_PROGRAM_ID;
  let extension: ExtensionType | undefined;
  let timestamp = 50n;
  const equity = {
    id: 'tesla',
    ticker: 'TSLA',
    name: 'Tesla',
    category: 'equity',
    variants: [
      {
        mint: mint.toBase58(),
        symbol: 'TSLAx',
        name: 'Tesla xStock',
        issuer: 'xStocks',
        decimals: 8,
      },
    ],
  };
  const tokens = {
    resolveMint: jest.fn(() => Promise.resolve(equity)),
    getVariants: jest.fn().mockResolvedValue([]),
  };
  const account = (
    raw: string,
    state = 'initialized',
    pubkey = Keypair.generate().publicKey.toBase58(),
  ) => ({
    pubkey,
    account: {
      owner: program.toBase58(),
      data: {
        parsed: {
          info: {
            owner: wallet.toBase58(),
            mint: mint.toBase58(),
            state,
            tokenAmount: { amount: raw, decimals: 8 },
          },
        },
      },
    },
  });
  let accounts = [
    account('123456789'),
    account('1'),
    account('500000000', 'frozen'),
  ];
  const rpc = {
    call: jest.fn((method: string, params: unknown[]) => {
      if (
        method === 'getAccountInfo' &&
        params[0] === SYSVAR_CLOCK_PUBKEY.toBase58()
      ) {
        const data = Buffer.alloc(40);
        data.writeBigInt64LE(timestamp, 32);
        return Promise.resolve({
          value: { data: [data.toString('base64'), 'base64'] },
        });
      }
      if (method === 'getTokenAccountsByOwner')
        return Promise.resolve({
          value:
            (params[1] as { programId: string }).programId ===
            program.toBase58()
              ? accounts
              : [],
        });
      const data = Buffer.alloc(
        extension === undefined ? MINT_SIZE : getMintLen([extension]),
      );
      MintLayout.encode(
        {
          mintAuthorityOption: 0,
          mintAuthority: PublicKey.default,
          supply: 1000000000n,
          decimals: 8,
          isInitialized: true,
          freezeAuthorityOption: 0,
          freezeAuthority: PublicKey.default,
        },
        data,
      );
      if (extension !== undefined) {
        data[165] = AccountType.Mint;
        data.writeUInt16LE(extension, 166);
        data.writeUInt16LE(getTypeLen(extension), 168);
        if (extension === ExtensionType.ScaledUiAmountConfig)
          ScaledUiAmountConfigLayout.encode(
            {
              authority: PublicKey.default,
              multiplier: 2,
              newMultiplier: 4,
              newMultiplierEffectiveTimestamp: 100n,
            },
            data.subarray(170),
          );
      }
      return Promise.resolve({
        value: {
          owner: program.toBase58(),
          lamports: 1000000,
          executable: false,
          data: [data.toString('base64'), 'base64'],
        },
      });
    }),
  };
  const service = new WithdrawalStocksService(rpc as never, tokens as never);
  return {
    service,
    tokens,
    rpc,
    account,
    timestamp: (value: bigint) => {
      timestamp = value;
    },
    accounts: (rows: ReturnType<typeof account>[]) => {
      accounts = rows;
    },
    token2022: (type?: ExtensionType) => {
      program = TOKEN_2022_PROGRAM_ID;
      extension = type;
    },
  };
}

describe('stock withdrawal holdings and mint verification', () => {
  it.each(['0', '1'])(
    'ignores an unrelated 19-decimal account with amount %s without hiding stocks',
    async (raw) => {
      const f = fixture();
      const unrelated = f.account(raw);
      unrelated.account.data.parsed.info.mint = otherMint.toBase58();
      unrelated.account.data.parsed.info.tokenAmount.decimals = 19;
      f.accounts([f.account('100000000'), unrelated]);
      const result = await f.service.list(wallet.toBase58());
      expect(result.stocks).toHaveLength(1);
      expect(result.stocks[0].balance).toBe('1');
      expect(result.incomplete).toBe(false);
    },
  );
  it('displays scaled xStock balances and switches multipliers using cluster time', async () => {
    const f = fixture();
    f.token2022(ExtensionType.ScaledUiAmountConfig);
    f.accounts([f.account('100000000')]);
    expect((await f.service.list(wallet.toBase58())).stocks[0].balance).toBe(
      '2',
    );
    f.timestamp(100n);
    expect((await f.service.list(wallet.toBase58())).stocks[0].balance).toBe(
      '4',
    );
  });

  it('rejects a review if the stock multiplier changed before signing', async () => {
    const f = fixture();
    f.token2022(ExtensionType.ScaledUiAmountConfig);
    const review = {
      asset: 'STOCK',
      mint: mint.toBase58(),
      decimals: 8,
      scaleMultiplier: '2',
    };
    await expect(f.service.assertReviewed(review)).resolves.toBeUndefined();
    f.timestamp(100n);
    await expect(f.service.assertReviewed(review)).rejects.toThrow(
      'share adjustment changed',
    );
  });
  it('lists available wallet shares exactly, combining accounts and excluding frozen shares', async () => {
    const f = fixture();
    const result = await f.service.list(wallet.toBase58());
    expect(result.stocks).toHaveLength(1);
    expect(result.stocks[0]).toMatchObject({
      mint: mint.toBase58(),
      symbol: 'TSLAx',
      issuer: 'xStocks',
      balance: '1.2345679',
      decimals: 8,
    });
    expect(f.rpc.call).toHaveBeenCalledWith('getTokenAccountsByOwner', [
      wallet.toBase58(),
      { programId: TOKEN_2022_PROGRAM_ID.toBase58() },
      { commitment: 'confirmed', encoding: 'jsonParsed' },
    ]);
  });

  it('verifies a registered mint and takes precision from its onchain data', async () => {
    const f = fixture();
    const result = await f.service.resolve(mint.toBase58());
    expect(result.decimals).toBe(8);
    expect(result.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(result.accountSize).toBe(165);
  });

  it('supports a Token-2022 stock and includes immutable-owner rent in the account size', async () => {
    const f = fixture();
    f.token2022();
    const result = await f.service.resolve(mint.toBase58());
    expect(result.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(result.accountSize).toBe(170);
  });

  it('supports token metadata without adding a spurious account extension', async () => {
    const f = fixture();
    f.token2022(ExtensionType.MetadataPointer);
    expect((await f.service.resolve(mint.toBase58())).accountSize).toBe(170);
  });

  it.each([
    ExtensionType.TransferFeeConfig,
    ExtensionType.TransferHook,
    ExtensionType.NonTransferable,
  ])(
    'rejects unprepared transfer behavior %s before approval',
    async (extension) => {
      const f = fixture();
      f.token2022(extension);
      await expect(f.service.resolve(mint.toBase58())).rejects.toThrow(
        'issuer transfer rules',
      );
    },
  );

  it('rejects an arbitrary token even if the resolved company has another valid variant', async () => {
    const f = fixture();
    await expect(f.service.resolve(otherMint.toBase58())).rejects.toThrow(
      'not a supported stock',
    );
    expect(f.rpc.call).not.toHaveBeenCalled();
  });

  it('does not silently turn a provider outage into an empty holdings list', async () => {
    const f = fixture();
    f.tokens.resolveMint.mockRejectedValue(new Error('Provider offline'));
    expect(await f.service.list(wallet.toBase58())).toEqual({
      stocks: [],
      incomplete: true,
    });
  });

  it('rejects a duplicated wallet account rather than double-counting its shares', async () => {
    const f = fixture();
    const account = f.account('100000000');
    f.accounts([account, account]);
    await expect(f.service.list(wallet.toBase58())).rejects.toThrow(
      'verify stock balances',
    );
  });
});
