import { atr } from './atr';
import { bollinger } from './bollinger';
import { ema } from './ema';
import { macd } from './macd';
import { momentum } from './momentum';
import { rsi } from './rsi';
import { sma } from './sma';
import { volatility } from './volatility';
import { volumeTrend } from './volume-trend';

describe('indicators', () => {
  it('computes momentum percent return', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 110];
    // lookback 7: from index 0 (100) to last (110)
    expect(momentum(closes, 7)).toBeCloseTo(10);
  });

  it('returns 0 momentum with insufficient data', () => {
    expect(momentum([1, 2], 7)).toBe(0);
  });

  it('computes SMA', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([10, 20, 30], 2)).toBe(25);
  });

  it('computes RSI in expected range', () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    const value = rsi(up, 14);
    expect(value).toBeGreaterThan(70);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('computes positive volatility for noisy series', () => {
    const closes = [100, 102, 99, 103, 98, 104, 97, 105, 96, 106];
    // pad to 31+
    const series = [...Array(25).fill(100), ...closes];
    expect(volatility(series, 30)).toBeGreaterThan(0);
  });

  it('computes volume trend ratio', () => {
    const prior = Array(7).fill(100);
    const recent = Array(7).fill(200);
    expect(volumeTrend([...prior, ...recent], 7)).toBeCloseTo(2);
  });

  it('computes EMA', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(ema(values, 10)).toBeGreaterThan(10);
  });

  it('computes MACD components', () => {
    const closes = Array.from({ length: 60 }, (_, index) => 100 + index * 0.5);
    const result = macd(closes);
    expect(result.line).not.toBe(0);
    expect(result.histogram).toBeCloseTo(result.line - result.signal, 5);
  });

  it('computes ATR from OHLCV bars', () => {
    const bars = Array.from({ length: 20 }, (_, index) => ({
      timestamp: new Date(index),
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
    }));
    expect(atr(bars, 14)).toBeGreaterThan(0);
  });

  it('computes Bollinger bands', () => {
    const closes = Array.from({ length: 30 }, () => 100);
    const bands = bollinger(closes, 20, 2);
    expect(bands.upper).toBeGreaterThanOrEqual(bands.middle);
    expect(bands.lower).toBeLessThanOrEqual(bands.middle);
  });
});
