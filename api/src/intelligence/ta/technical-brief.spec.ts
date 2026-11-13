import type { MarketCandle } from '../../../types/market';
import { buildTechnicalBrief } from './technical-brief';

function makeBars(count: number, startPrice = 100): MarketCandle[] {
  const bars: MarketCandle[] = [];
  for (let index = 0; index < count; index++) {
    const drift = Math.sin(index / 8) * 4 + index * 0.08;
    const close = startPrice + drift;
    bars.push({
      timestamp: new Date(Date.UTC(2024, 0, 1 + index)),
      open: close - 0.5,
      high: close + 1.5,
      low: close - 1.5,
      close,
      volume: 1000 + index * 10,
    });
  }
  return bars;
}

describe('buildTechnicalBrief', () => {
  it('builds regime, setup, levels, and daily indicators from OHLCV', () => {
    const dailyBars = makeBars(220, 120);
    const brief = buildTechnicalBrief({
      price: dailyBars.at(-1)!.close,
      dailyBars,
      newsItems: [
        {
          headline: 'Shares rally after earnings beat',
          publishedAt: new Date(),
        },
      ],
    });

    expect(brief.regime).toMatch(/uptrend|downtrend|range/);
    expect(brief.setup).toMatch(
      /continuation|mean_reversion|breakout|insufficient/,
    );
    expect(brief.primaryTimeframe.timeframe).toBe('daily');
    expect(brief.primaryTimeframe.rsi14).toBeGreaterThan(0);
    expect(brief.primaryTimeframe.sma200).toBeDefined();
    expect(brief.weeklyTimeframe?.timeframe).toBe('weekly');
    expect(brief.levels.length).toBeGreaterThan(0);
    expect(brief.newsOverlay?.[0]?.alignment).toBe('with_regime');
  });

  it('marks limited daily history when daily bars are thin but hourly can still drive setup', () => {
    const hourlyBars = makeBars(120, 100);
    const brief = buildTechnicalBrief({
      price: hourlyBars.at(-1)!.close,
      dailyBars: makeBars(25),
      hourlyBars,
    });

    expect(brief.limitedHistory).toBe(true);
    expect(brief.setup).not.toBe('insufficient');
    expect(brief.hourlyTimeframe).toBeDefined();
    expect(brief.levels.length).toBeGreaterThan(0);
  });

  it('marks setup insufficient only when both daily and hourly are unavailable', () => {
    const brief = buildTechnicalBrief({
      price: 100,
      dailyBars: makeBars(10),
      hourlyBars: makeBars(5),
    });

    expect(brief.setup).toBe('insufficient');
  });
});
