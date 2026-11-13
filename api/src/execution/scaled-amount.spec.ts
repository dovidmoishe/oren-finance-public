import { computeLimitOrderAmounts } from './jupiter/limit-order-math';
import {
  effectiveMultiplier,
  parseScaledUiConfig,
  rawToQuoteAmount,
  stockSharesToRaw,
} from './scaled-amount';
import { uiAmountToRaw } from './jupiter/jupiter.mapper';
import { scaledSellAmount } from './variant-selector';

// Real NVDAx mint state read on 2026-11-06 for the failing "sell all".
const nvdax = parseScaledUiConfig({
  multiplier: '1.0009180758490996',
  newMultiplier: '1.001701196801074',
  newMultiplierEffectiveTimestamp: 1789000200,
})!;
const HELD_RAW = 527_162n;
const SHOWN_SHARES = 0.00528058;

describe('xStock scaled amounts', () => {
  it('uses the new multiplier once its effective time has passed', () => {
    expect(effectiveMultiplier(nvdax, 1789000200 * 1000 - 1)).toBe(
      1.0009180758490996,
    );
    expect(effectiveMultiplier(nvdax, 1789000200 * 1000)).toBe(
      1.001701196801074,
    );
    expect(effectiveMultiplier(undefined)).toBe(1);
  });

  it('never sells more raw units than the wallet holds when selling all shown shares', () => {
    const multiplier = effectiveMultiplier(nvdax, Date.parse('2026-11-06'));
    const raw = stockSharesToRaw(SHOWN_SHARES, 8, multiplier);
    expect(raw <= HELD_RAW).toBe(true);
    expect(HELD_RAW - raw <= 1n).toBe(true);
    // The old conversion asked for 528,058 raw units and failed simulation.
    expect(uiAmountToRaw(SHOWN_SHARES, 8)).toBe('528058');
  });

  it('feeds the swap an amount that converts back to exactly the scaled raw units', () => {
    const multiplier = effectiveMultiplier(nvdax, Date.parse('2026-11-06'));
    const amount = scaledSellAmount(SHOWN_SHARES, 8, multiplier);
    expect(uiAmountToRaw(amount, 8)).toBe(
      String(stockSharesToRaw(SHOWN_SHARES, 8, multiplier)),
    );
    expect(rawToQuoteAmount(527_161n, 8)).toBe(0.00527161);
  });

  it('leaves unscaled tokens untouched', () => {
    expect(scaledSellAmount(0.5, 8, undefined)).toBe(0.5);
    expect(scaledSellAmount(0.5, 8, 1)).toBe(0.5);
    expect(stockSharesToRaw(0.00528058, 8)).toBe(528_058n);
  });

  it('rejects zero, dust and invalid multipliers safely', () => {
    expect(() => stockSharesToRaw(0, 8, 1.0017)).toThrow();
    expect(() => stockSharesToRaw(1e-12, 8, 1.0017)).toThrow();
    expect(parseScaledUiConfig({ multiplier: 'abc' })).toBeUndefined();
    expect(parseScaledUiConfig(null)).toBeUndefined();
  });

  it('scales stock-side limit order amounts', () => {
    const sell = computeLimitOrderAmounts({
      side: 'sell',
      amount: 0.1,
      limitPriceUsd: 200,
      stockDecimals: 8,
      stockMultiplier: 1.001701196801074,
    });
    expect(BigInt(sell.makingAmountRaw)).toBeLessThan(10_000_000n);
    expect(sell.makingAmountRaw).toBe(
      String(stockSharesToRaw(0.1, 8, 1.001701196801074)),
    );
    const unscaled = computeLimitOrderAmounts({
      side: 'sell',
      amount: 0.1,
      limitPriceUsd: 200,
      stockDecimals: 8,
    });
    expect(unscaled.makingAmountRaw).toBe('10000000');
  });
});
