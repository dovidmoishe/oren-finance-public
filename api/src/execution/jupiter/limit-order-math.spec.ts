import {
  computeLimitOrderAmounts,
  defaultLimitExpiredAt,
  LIMIT_ORDER_MIN_USD,
} from './limit-order-math';

describe('computeLimitOrderAmounts', () => {
  it('converts a buy limit into USDC making / stock taking', () => {
    const result = computeLimitOrderAmounts({
      side: 'buy',
      amount: 100,
      limitPriceUsd: 50,
      stockDecimals: 6,
      marketPriceUsd: 55,
    });

    expect(result.makingAmount).toBe(100);
    expect(result.takingAmount).toBe(2);
    expect(result.makingAmountRaw).toBe('100000000');
    expect(result.takingAmountRaw).toBe('2000000');
    expect(result.amountUsd).toBe(100);
    expect(result.wouldFillImmediately).toBe(false);
  });

  it('flags buy limits that are already through the market', () => {
    const result = computeLimitOrderAmounts({
      side: 'buy',
      amount: 100,
      limitPriceUsd: 60,
      stockDecimals: 6,
      marketPriceUsd: 55,
    });
    expect(result.wouldFillImmediately).toBe(true);
  });

  it('converts a sell limit into stock making / USDC taking', () => {
    const result = computeLimitOrderAmounts({
      side: 'sell',
      amount: 2,
      limitPriceUsd: 50,
      stockDecimals: 6,
      marketPriceUsd: 45,
    });

    expect(result.makingAmount).toBe(2);
    expect(result.takingAmount).toBe(100);
    expect(result.makingAmountRaw).toBe('2000000');
    expect(result.takingAmountRaw).toBe('100000000');
    expect(result.wouldFillImmediately).toBe(false);
  });

  it('rejects orders below Jupiter minimum notional', () => {
    expect(() =>
      computeLimitOrderAmounts({
        side: 'buy',
        amount: LIMIT_ORDER_MIN_USD - 1,
        limitPriceUsd: 10,
        stockDecimals: 6,
      }),
    ).toThrow(/at least/);
  });

  it('defaults expiry about 30 days out', () => {
    const now = Date.UTC(2026, 8, 15);
    expect(defaultLimitExpiredAt(now)).toBe(
      Math.floor(now / 1000) + 30 * 24 * 60 * 60,
    );
  });
});
