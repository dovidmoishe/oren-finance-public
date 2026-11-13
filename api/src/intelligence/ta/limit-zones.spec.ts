import { buildLimitZones } from './limit-zones';

describe('buildLimitZones', () => {
  it('prefers swing support/resistance for buy and sell zones', () => {
    const zones = buildLimitZones({
      price: 100,
      levels: [
        { price: 92, label: 'support', distancePct: -8 },
        { price: 110, label: 'resistance', distancePct: 10 },
      ],
      bollinger: { upper: 108, middle: 100, lower: 90, bandwidth: 18 },
      atr14: 4,
    });

    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({
      side: 'buy',
      preferredUsd: 92,
      conservativeUsd: 91,
      aggressiveUsd: 93,
      basis: 'swing_support',
    });
    expect(zones[1]).toMatchObject({
      side: 'sell',
      preferredUsd: 110,
      aggressiveUsd: 109,
      conservativeUsd: 111,
      basis: 'swing_resistance',
    });
    expect(zones[0].preferredUsd - zones[0].conservativeUsd!).toBeCloseTo(
      zones[0].aggressiveUsd! - zones[0].preferredUsd,
    );
    expect(zones[1].conservativeUsd! - zones[1].preferredUsd).toBeCloseTo(
      zones[1].preferredUsd - zones[1].aggressiveUsd!,
    );
  });

  it('omits a sell wing that would have to be clamped onto the live price', () => {
    const price = 410.53;
    const zones = buildLimitZones({
      price,
      levels: [
        { price: 400.52, label: 'support', distancePct: -2.44 },
        { price: 411.19, label: 'resistance', distancePct: 0.16 },
      ],
      atr14: 16.92,
    });
    const buy = zones.find((zone) => zone.side === 'buy');
    const sell = zones.find((zone) => zone.side === 'sell');
    expect(buy).toMatchObject({
      preferredUsd: 400.52,
      conservativeUsd: 396.29,
      aggressiveUsd: 404.75,
    });
    expect(sell).toMatchObject({
      preferredUsd: 411.19,
      conservativeUsd: 415.42,
    });
    expect(sell?.aggressiveUsd).toBeUndefined();
    expect(buy!.aggressiveUsd!).toBeLessThan(price);
    expect(sell!.preferredUsd).toBeGreaterThan(price);
    expect(sell!.conservativeUsd!).toBeGreaterThan(sell!.preferredUsd);
  });

  it('falls back to Bollinger bands when swings are missing', () => {
    const zones = buildLimitZones({
      price: 100,
      levels: [],
      bollinger: { upper: 112, middle: 100, lower: 88, bandwidth: 24 },
      atr14: 2,
    });

    expect(zones.find((zone) => zone.side === 'buy')?.basis).toBe(
      'bollinger_lower',
    );
    expect(zones.find((zone) => zone.side === 'sell')?.basis).toBe(
      'bollinger_upper',
    );
  });

  it('omits invalid sides when no level exists', () => {
    const zones = buildLimitZones({
      price: 100,
      levels: [{ price: 105, label: 'resistance', distancePct: 5 }],
      bollinger: { upper: 0, middle: 0, lower: 0, bandwidth: 0 },
    });

    expect(zones.map((zone) => zone.side)).toEqual(['sell']);
  });
});
