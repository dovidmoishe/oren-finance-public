import { USDC_MINT } from '../config/constants';
import { buildVerifiedFill } from './volume.worker';

const wallet = 'Wallet11111111111111111111111111111111111';
const stockMint = 'StockMint11111111111111111111111111111111';

function execution(type: 'stock_purchase' | 'stock_sale') {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    walletAddress: wallet,
    type,
    assetId: 'spacex',
    ticker: 'SPACEX',
    tokenMint: stockMint,
    featureSource: 'direct',
    provider: 'jupiter',
  };
}

function balance(mint: string, amount: number) {
  return { mint, owner: wallet, uiTokenAmount: { uiAmountString: String(amount), decimals: 6 } };
}

describe('buildVerifiedFill', () => {
  it('uses actual wallet deltas for buy volume', () => {
    const fill = buildVerifiedFill(execution('stock_purchase'), 'sig-buy', {
      slot: 42,
      blockTime: 1_700_000_000,
      meta: {
        preTokenBalances: [balance(stockMint, 1), balance(USDC_MINT, 100)],
        postTokenBalances: [balance(stockMint, 1.5), balance(USDC_MINT, 60)],
      },
    });
    expect(fill.side).toBe('buy');
    expect(fill.stockAmount).toBeCloseTo(0.5);
    expect(fill.usdNotional).toBeCloseTo(40);
    expect(fill.executionPriceUsd).toBeCloseTo(80);
  });

  it('uses actual wallet deltas for sell volume', () => {
    const fill = buildVerifiedFill(execution('stock_sale'), 'sig-sell', {
      slot: 43,
      blockTime: 1_700_000_001,
      meta: {
        preTokenBalances: [balance(stockMint, 2), balance(USDC_MINT, 10)],
        postTokenBalances: [balance(stockMint, 1.75), balance(USDC_MINT, 35)],
      },
    });
    expect(fill.side).toBe('sell');
    expect(fill.stockAmount).toBeCloseTo(0.25);
    expect(fill.usdNotional).toBeCloseTo(25);
  });

  it('fails closed when token deltas contradict the intent', () => {
    expect(() => buildVerifiedFill(execution('stock_purchase'), 'sig-bad', {
      slot: 44,
      blockTime: 1_700_000_002,
      meta: {
        preTokenBalances: [balance(stockMint, 2), balance(USDC_MINT, 10)],
        postTokenBalances: [balance(stockMint, 1.5), balance(USDC_MINT, 50)],
      },
    })).toThrow('do not match');
  });

  const buy = {
    slot: 45,
    blockTime: 1_700_000_000,
    meta: {
      preTokenBalances: [balance(stockMint, 1), balance(USDC_MINT, 100)],
      postTokenBalances: [balance(stockMint, 1.5), balance(USDC_MINT, 60)],
    },
  };

  it('refuses swap volume from a transaction another wallet paid for', () => {
    expect(() => buildVerifiedFill(execution('stock_purchase'), 'sig-other', {
      ...buy,
      transaction: { message: { accountKeys: [{ pubkey: 'Someone1111111111111111111111111111111111', signer: true }] } },
    }, { requireWalletFeePayer: true })).toThrow('fee payer');
    expect(() => buildVerifiedFill(execution('stock_purchase'), 'sig-missing', buy, {
      requireWalletFeePayer: true,
    })).toThrow('fee payer');
  });

  it('accepts swap volume the execution wallet signed and paid for', () => {
    const fill = buildVerifiedFill(execution('stock_purchase'), 'sig-own', {
      ...buy,
      transaction: { message: { accountKeys: [{ pubkey: wallet, signer: true }] } },
    }, { requireWalletFeePayer: true });
    expect(fill.walletAddress).toBe(wallet);
  });

  it('refuses a trade that landed before the execution was prepared', () => {
    expect(() => buildVerifiedFill(
      { ...execution('stock_purchase'), createdAt: new Date(1_700_000_000_000 + 10 * 60_000) },
      'sig-old',
      buy,
    )).toThrow('predates');
  });
});
