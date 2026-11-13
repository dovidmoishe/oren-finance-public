import {
  reservationNotionalUsd,
  sellNotionalUsd,
  usdMicros,
  buyNotionalUsd,
} from './trade-budget';
import { rawSellReferenceUsd, rawSellShares } from './delegated-amounts';

describe('MCP trade budget amounts', () => {
  it('normalizes quoted raw sell shares without floating-point or storage rounding', () => {
    expect(rawSellShares('12345679', 8)).toBe('0.123456790000');
    expect(
      rawSellReferenceUsd('12345679', rawSellShares('12345679', 8), 8, 100),
    ).toBe('12.345679');
    expect(rawSellShares('100000000000000001', 8)).toBe(
      '1000000000.000000010000',
    );
    expect(rawSellShares('1', 0)).toBe('1.000000000000');
    expect(rawSellShares('1000000', 18)).toBe('0.000000000001');
    expect(() => rawSellShares('1', 18)).toThrow('exact intent precision');
    expect(() => rawSellShares('18446744073709551616', 8)).toThrow();
    expect(() => rawSellShares('0', 8)).toThrow();
  });
  it('derives buy charges from exact USDC and rejects forged display amounts', () => {
    expect(buyNotionalUsd('1000000', '0.010000')).toBeUndefined();
    expect(buyNotionalUsd('1000000', '1')).toBe('1.000000');
    expect(buyNotionalUsd('1', '0.000001')).toBe('0.000001');
    expect(buyNotionalUsd('1000000', null)).toBeUndefined();
    for (const invalid of ['0', '-1', '1e6', '01', '18446744073709551616'])
      expect(buyNotionalUsd(invalid, '1')).toBeUndefined();
    const forged = {
      side: 'buy' as const,
      maxInRaw: '1000000',
      amountUsd: '0.010000',
      referenceValueUsd: null,
      quotedProceedsUsd: null,
    };
    expect(
      reservationNotionalUsd(forged, { rawInput: '1000000' }),
    ).toBeUndefined();
    expect(
      reservationNotionalUsd(
        { ...forged, amountUsd: '1.000000' },
        { rawInput: '1000000' },
      ),
    ).toBe('1.000000');
    expect(
      reservationNotionalUsd(
        { ...forged, amountUsd: '1.000000' },
        { rawInput: '999999' },
      ),
    ).toBeUndefined();
  });

  it('values raw shares using verified decimals, rounding microdollars upward', () => {
    expect(rawSellReferenceUsd('1000000', '1.000000000000', 6, 25)).toBe(
      '25.000000',
    );
    expect(rawSellReferenceUsd('1', '0.000000001', 9, 1)).toBe('0.000001');
    expect(rawSellReferenceUsd('1', '0.000001', 6, 1.000001)).toBe('0.000002');
    expect(rawSellReferenceUsd('1000000', '1', 6, 1e-7)).toBe('0.000001');
    expect(() => rawSellReferenceUsd('1000000', '0.01', 6, 25)).toThrow(
      'differs',
    );
    expect(() => rawSellReferenceUsd('1000000', null, 6, 25)).toThrow();
    expect(() => rawSellReferenceUsd('1000000', '1', 6, NaN)).toThrow();
  });
  it('compares six-decimal amounts exactly', () => {
    expect(usdMicros('25')).toBe(25_000_000n);
    expect(usdMicros('0.000001')).toBe(1n);
    expect(usdMicros('50.123456')).toBe(50_123_456n);
    expect(() => usdMicros('1.0000001')).toThrow();
    expect(() => usdMicros('-1')).toThrow();
  });

  it('charges the greater of independent sell valuation and swap proceeds', () => {
    expect(sellNotionalUsd('25.100000', '24.900000')).toBe('25.100000');
    expect(sellNotionalUsd('24.900000', '25.100000')).toBe('25.100000');
    expect(() => sellNotionalUsd('0', '0')).toThrow();
  });

  it('caps sell share input and charges the greater saved or current value', () => {
    const intent = {
      side: 'sell' as const,
      maxInRaw: '1000000',
      amountUsd: null,
      referenceValueUsd: '20.000000',
      quotedProceedsUsd: '19.000000',
    };
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000001',
        referenceValueUsd: '21',
        quotedProceedsUsd: '20',
      }),
    ).toBeUndefined();
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000000',
        referenceValueUsd: '18',
        quotedProceedsUsd: '19',
      }),
    ).toBe('20.000000');
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000000',
        referenceValueUsd: '18',
        quotedProceedsUsd: '22',
      }),
    ).toBe('22.000000');
    expect(
      reservationNotionalUsd(intent, {
        rawInput: '1000000',
        quotedProceedsUsd: '22',
      }),
    ).toBeUndefined();
  });
});
