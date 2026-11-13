import type { TechnicalBrief } from '../../../types/analysis';
import { plainTechnicalRead } from './plain-read';

function brief(overrides: Partial<TechnicalBrief> = {}): TechnicalBrief {
  return {
    regime: 'uptrend',
    setup: 'continuation',
    primaryTimeframe: {
      timeframe: 'daily',
      rsi14: 60.27,
      sma20: 379.63,
      sma50: 369.2,
      macd: { line: 8.5904, signal: 5.6654, histogram: 2.925 },
      atr14: 16.91,
      bollinger: {
        upper: 407.17,
        middle: 379.63,
        lower: 352.1,
        bandwidth: 14.51,
      },
      volumeTrend: 1.3929,
    },
    weeklyTimeframe: {
      timeframe: 'weekly',
      rsi14: 72.63,
      sma20: 340,
      sma50: 300,
      macd: { line: 1, signal: 1, histogram: 0.2 },
      atr14: 20,
      bollinger: { upper: 420, middle: 340, lower: 280, bandwidth: 10 },
    },
    levels: [
      { price: 400.52, label: 'support', distancePct: -2.44 },
      { price: 411.19, label: 'resistance', distancePct: 0.16 },
    ],
    limitZones: [
      {
        side: 'buy',
        preferredUsd: 400.52,
        conservativeUsd: 396.29,
        aggressiveUsd: 404.75,
        basis: 'swing_support',
        distancePct: -2.44,
      },
      {
        side: 'sell',
        preferredUsd: 411.19,
        conservativeUsd: 415.42,
        basis: 'swing_resistance',
        distancePct: 0.16,
      },
    ],
    risks: ['Wide Bollinger bandwidth — price is moving fast.'],
    limitedHistory: false,
    ...overrides,
  };
}

describe('plainTechnicalRead', () => {
  it('leads with a plain stall-and-dip read and hides indicators', () => {
    const read = plainTechnicalRead({
      ticker: 'TSLA',
      name: 'Tesla, Inc.',
      opportunityScore: 80.19,
      riskLabel: 'moderate',
      technicalBrief: brief(),
    });

    expect(read.lead).toBe(
      'Tesla has been climbing and is right under a level where it often stalls (~$411). A dip toward ~$401 would be a better entry.',
    );
    expect(read.lead.toLowerCase()).not.toContain('breakout');
    expect(read.bullets.join(' ')).not.toMatch(
      /RSI|MACD|SMA|ATR|Bollinger|Oren Score/i,
    );
    expect(read.bullets.length).toBeGreaterThanOrEqual(3);
    expect(read.bullets.length).toBeLessThanOrEqual(5);
    expect(read.details).toContain('RSI14: 60.27');
    expect(read.details).toContain('Oren Score: 80');
    expect(read.details).toContain('aggressive 404.75');
    expect(read.details).not.toMatch(/aggressive 410/);
  });
});
