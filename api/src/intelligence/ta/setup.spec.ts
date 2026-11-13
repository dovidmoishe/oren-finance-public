import { setupClass } from './setup';

const base = {
  regime: 'uptrend' as const,
  rsi14: 60.27,
  price: 410.53,
  sma20: 379.63,
  bollinger: { upper: 407.17, middle: 379.63, lower: 352.1, bandwidth: 14.51 },
  volumeTrend: 1.3929,
  atr14: 16.91,
  limitedHistory: false,
};

describe('setupClass', () => {
  it('does not call a stall under nearby resistance a breakout', () => {
    expect(
      setupClass({
        ...base,
        resistanceDistancePct: 0.16,
        supportDistancePct: -2.44,
      }),
    ).toBe('continuation');
  });

  it('still calls a band push a breakout when the next swing is not in the way', () => {
    expect(
      setupClass({
        ...base,
        resistanceDistancePct: 4.5,
        supportDistancePct: -2.44,
      }),
    ).toBe('breakout');
  });

  it('does not call a stall onto nearby support a downside breakout', () => {
    expect(
      setupClass({
        ...base,
        regime: 'downtrend',
        price: 90,
        sma20: 100,
        bollinger: { upper: 110, middle: 100, lower: 91, bandwidth: 19 },
        volumeTrend: 1.4,
        atr14: 3,
        resistanceDistancePct: 8,
        supportDistancePct: -0.4,
      }),
    ).toBe('continuation');
  });
});
