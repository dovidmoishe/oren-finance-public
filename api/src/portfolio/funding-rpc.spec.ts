import { FundingRpc } from './funding-rpc.service';
import { AlchemyClient } from '../alchemy/alchemy.client';
import type { AppEnv } from '../config/env.schema';
import { USDC_MINT } from '../config/constants';

describe('confirmed funding snapshots', () => {
  const call = jest.fn();
  const env = {
    SOLANA_NETWORK: 'mainnet',
    ALCHEMY_API_KEY: 'test-key',
  } as AppEnv;
  const rpc = new FundingRpc({ call } as unknown as AlchemyClient, env);
  const token = (
    pubkey: string,
    amount: string,
    owner = 'wallet',
    mint = USDC_MINT,
  ) => ({
    pubkey,
    account: {
      data: {
        parsed: { info: { owner, mint, tokenAmount: { amount, decimals: 6 } } },
      },
    },
  });
  const reply = (tokens: unknown[], lamports = 1234567890) => {
    call.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'getBalance'
          ? { context: { slot: 100 }, value: lamports }
          : { context: { slot: 101 }, value: tokens },
      ),
    );
  };
  beforeEach(() => call.mockReset());

  it('sums all USDC token accounts with integer precision, including values beyond JS safe integers', async () => {
    reply([token('one', '9007199254740993'), token('two', '7')]);
    const { data, accounts } = await rpc.snapshot('wallet', 99);
    expect(data).toMatchObject({
      usdcAtomic: '9007199254741000',
      usdc: '9007199254.741',
      sol: '1.23456789',
      solLamports: '1234567890',
      slot: 100,
      commitment: 'confirmed',
    });
    expect(accounts).toEqual(
      expect.arrayContaining(['one', 'two', rpc.associatedAccount('wallet')]),
    );
    expect(call).toHaveBeenCalledWith(
      'getBalance',
      ['wallet', { commitment: 'confirmed', minContextSlot: 99 }],
      undefined,
    );
  });

  it('supports an empty new wallet and includes its not-yet-created associated account', async () => {
    reply([], 0);
    const { data, accounts } = await rpc.snapshot('wallet');
    expect(data.sol).toBe('0');
    expect(data.usdc).toBe('0');
    expect(accounts).toEqual([rpc.associatedAccount('wallet')]);
  });

  it.each([
    [token('one', '1', 'stranger')],
    [token('one', '1', 'wallet', 'wrong-mint')],
    [token('one', '1.5')],
    [token('one', '-1')],
    [token('one', '1'), token('one', '2')],
  ])('rejects malformed or mismatched token data %#', async (...accounts) => {
    reply(accounts);
    await expect(rpc.snapshot('wallet')).rejects.toMatchObject({ status: 503 });
  });

  it('rejects stale or imprecise RPC data', async () => {
    reply([]);
    await expect(rpc.snapshot('wallet', 102)).rejects.toMatchObject({
      status: 503,
    });
    reply([], Number.MAX_SAFE_INTEGER + 1);
    await expect(rpc.snapshot('wallet')).rejects.toMatchObject({ status: 503 });
  });

  it('keeps provider secrets out of user-visible failures', async () => {
    call.mockRejectedValue(new Error('https://provider/test-secret'));
    await expect(rpc.snapshot('wallet')).rejects.toThrow(
      'Unable to verify funding balances',
    );
  });

  it('fails closed on devnet instead of showing mainnet USDC as test funds', async () => {
    const devnet = new FundingRpc({ call } as unknown as AlchemyClient, {
      ...env,
      SOLANA_NETWORK: 'devnet',
    });
    await expect(devnet.snapshot('wallet')).rejects.toMatchObject({
      status: 503,
    });
    expect(call).not.toHaveBeenCalled();
  });
});
