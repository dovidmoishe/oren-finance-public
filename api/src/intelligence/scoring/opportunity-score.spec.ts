import {
  SCORE_WEIGHTS,
  computeOpportunityScore,
} from './opportunity-score';

describe('opportunity-score', () => {
  it('has weights that sum to 1', () => {
    const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  it('scores strong momentum/trend higher than weak', () => {
    const strong = computeOpportunityScore({
      momentum7d: 12,
      momentum30d: 20,
      price: 120,
      sma20: 110,
      sma50: 100,
      volumeTrend: 1.5,
      volatility30d: 1.2,
      liquidityScore: 80,
      activityScore: 75,
    });
    const weak = computeOpportunityScore({
      momentum7d: -12,
      momentum30d: -20,
      price: 80,
      sma20: 100,
      sma50: 110,
      volumeTrend: 0.5,
      volatility30d: 6,
      liquidityScore: 20,
      activityScore: 20,
    });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeGreaterThanOrEqual(0);
    expect(strong.score).toBeLessThanOrEqual(100);
  });

  it('uses neutral dimensions for limited history', () => {
    const result = computeOpportunityScore({
      momentum7d: 50,
      momentum30d: 50,
      price: 100,
      sma20: 100,
      sma50: 100,
      volumeTrend: 5,
      volatility30d: 10,
      liquidityScore: 60,
      activityScore: 60,
      limitedHistory: true,
    });
    expect(result.dimensions.momentum).toBe(50);
    expect(result.dimensions.trend).toBe(50);
    expect(result.dimensions.volume).toBe(50);
    expect(result.dimensions.volatility).toBe(50);
  });
});
