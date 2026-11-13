import { buildHighlights, riskLabelFromVolatility } from './highlights';
import type { ScoreDimensions } from '../../types/signals';

describe('highlights', () => {
  const baseDims: ScoreDimensions = {
    momentum: 80,
    trend: 75,
    volume: 60,
    volatility: 70,
    liquidity: 80,
    activity: 60,
  };

  it('flags strong momentum and SMA position', () => {
    const highlights = buildHighlights(
      {
        momentum7d: 8,
        momentum30d: 12,
        rsi14: 55,
        sma20: 105,
        sma50: 100,
        volumeTrend: 1.4,
        liquidityScore: 80,
        volatility30d: 1.5,
      },
      baseDims,
      { price: 110 },
    );
    expect(highlights).toContain('Strong 7d momentum');
    expect(highlights).toContain('Above SMA50');
    expect(highlights).toContain('Rising volume');
  });

  it('flags thin liquidity', () => {
    const highlights = buildHighlights(
      {
        momentum7d: 0,
        momentum30d: 0,
        rsi14: 50,
        sma20: 100,
        sma50: 100,
        volumeTrend: 1,
        liquidityScore: 20,
        volatility30d: 2,
      },
      { ...baseDims, liquidity: 20, momentum: 40, trend: 40 },
      { price: 100 },
    );
    expect(highlights).toContain('Thin liquidity');
  });

  it('maps volatility to risk labels', () => {
    expect(riskLabelFromVolatility(1)).toBe('low');
    expect(riskLabelFromVolatility(2.5)).toBe('moderate');
    expect(riskLabelFromVolatility(4)).toBe('elevated');
    expect(riskLabelFromVolatility(8)).toBe('high');
    expect(riskLabelFromVolatility(8, 'low')).toBe('low');
  });
});
