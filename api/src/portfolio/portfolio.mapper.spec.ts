import {
  applyAllocations,
  buildPortfolio,
  buildPositions,
  cashFromBalances,
  equityValueFromSnapshot,
  isCashMint,
  type HoldingLot,
} from './portfolio.mapper';
import { USDC_MINT, USD_ASSET_ID } from '../config/constants';
import type { Equity } from '../../types/equity';

function equity(
  id: string,
  ticker: string,
  variants: { mint: string; symbol?: string }[],
  price = 100,
): Equity {
  return {
    id,
    ticker,
    name: ticker,
    category: 'equity',
    price,
    priceChange24h: 1.5,
    variants: variants.map((v) => ({
      mint: v.mint,
      symbol: v.symbol ?? ticker,
      name: ticker,
      tradable: true,
    })),
  };
}

describe('portfolio.mapper', () => {
  describe('isCashMint / cashFromBalances', () => {
    it('treats USDC mint and usd assetId as cash', () => {
      expect(isCashMint(USDC_MINT)).toBe(true);
      expect(isCashMint('otherMint', USD_ASSET_ID)).toBe(true);
      expect(isCashMint('otherMint', 'aapl')).toBe(false);
    });

    it('sums USDC balances as cashValueUsd', () => {
      expect(
        cashFromBalances([
          { mint: USDC_MINT, amount: 1000000, decimals: 6, uiAmount: 50 },
          { mint: 'equityMint', amount: 10, decimals: 6, uiAmount: 10 },
          { mint: USDC_MINT, amount: 0, decimals: 6, uiAmount: 0 },
        ]),
      ).toBe(50);
    });

    it('derives equity-only snapshot value from available and locked holdings', () => {
      expect(
        equityValueFromSnapshot({
          availableValueUsd: '120',
          lockedValueUsd: '30',
        }),
      ).toBe(150);
    });
  });

  describe('buildPositions', () => {
    it('skips unknown mints by never receiving them as lots', () => {
      const positions = buildPositions([], new Map());
      expect(positions).toEqual([]);
    });

    it('groups multi-issuer mints under one equity', () => {
      const aapl = equity('aapl', 'AAPL', [
        { mint: 'mintA', symbol: 'xAAPL' },
        { mint: 'mintB', symbol: 'yAAPL' },
      ]);
      const lots: HoldingLot[] = [
        { mint: 'mintA', amount: 2, equity: aapl, price: 100 },
        { mint: 'mintB', amount: 3, equity: aapl, price: 100 },
      ];
      const positions = buildPositions(lots, new Map());
      expect(positions).toHaveLength(1);
      expect(positions[0].assetId).toBe('aapl');
      expect(positions[0].quantity).toBe(5);
      expect(positions[0].valueUsd).toBe(500);
      expect(positions[0].variants).toHaveLength(2);
      expect(positions[0].lockedAmount).toBe(0);
      expect(positions[0].availableAmount).toBe(5);
    });

    it('includes locked vault amounts on matching mints', () => {
      const aapl = equity('aapl', 'AAPL', [{ mint: 'mintA' }]);
      const lots: HoldingLot[] = [
        { mint: 'mintA', amount: 1, equity: aapl, price: 10 },
      ];
      const locked = new Map([['mintA', 4]]);
      const positions = buildPositions(lots, locked);
      expect(positions[0].availableAmount).toBe(1);
      expect(positions[0].lockedAmount).toBe(4);
      expect(positions[0].quantity).toBe(5);
      expect(positions[0].lockedValueUsd).toBe(40);
    });
  });

  describe('allocation / portfolio totals', () => {
    it('computes allocationPercent against total including cash', () => {
      const positions = applyAllocations(
        [
          {
            assetId: 'aapl',
            ticker: 'AAPL',
            name: 'Apple',
            category: 'equity',
            currentPrice: 100,
            changePercent: 0,
            quantity: 1,
            valueUsd: 100,
            allocationPercent: 0,
            availableAmount: 1,
            lockedAmount: 0,
            availableValueUsd: 100,
            lockedValueUsd: 0,
          },
        ],
        200,
      );
      expect(positions[0].allocationPercent).toBe(50);
    });

    it('builds portfolio with cash, locked fields, and zero change without prior snapshot', () => {
      const portfolio = buildPortfolio({
        walletAddress: 'Wallet111',
        positions: [
          {
            assetId: 'aapl',
            ticker: 'AAPL',
            name: 'Apple',
            category: 'equity',
            currentPrice: 50,
            changePercent: 0,
            quantity: 2,
            valueUsd: 100,
            allocationPercent: 0,
            availableAmount: 2,
            lockedAmount: 0,
            availableValueUsd: 100,
            lockedValueUsd: 0,
          },
        ],
        cashValueUsd: 50,
        previousTotalValueUsd: null,
      });

      expect(portfolio.totalValueUsd).toBe(150);
      expect(portfolio.cashValueUsd).toBe(50);
      expect(portfolio.availableValueUsd).toBe(100);
      expect(portfolio.lockedValueUsd).toBe(0);
      expect(portfolio.absoluteChangeUsd).toBe(0);
      expect(portfolio.percentChange).toBe(0);
      expect(portfolio.positions[0].allocationPercent).toBeCloseTo(
        (100 / 150) * 100,
      );
    });

    it('computes change vs previous snapshot total', () => {
      const portfolio = buildPortfolio({
        walletAddress: 'Wallet111',
        positions: [],
        cashValueUsd: 120,
        previousTotalValueUsd: 100,
      });
      expect(portfolio.absoluteChangeUsd).toBe(20);
      expect(portfolio.percentChange).toBe(20);
    });
  });
});
