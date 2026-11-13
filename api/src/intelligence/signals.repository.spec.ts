import { stockSignals } from '../database/schema';
import { SignalsRepository, rowToSignals, type StockSignalRow } from './signals.repository';

const stockSignalRow = {
  id: '1',
  assetId: 'aapl',
  ticker: 'AAPL',
  momentum7d: '1.5',
  momentum30d: '3.25',
  volatility30d: '2.1',
  volumeTrend: '1.2',
  rsi14: '55.5',
  sma20: '190',
  sma50: '185',
  liquidityScore: '70',
  activityScore: '65',
  opportunityScore: '72.5',
  calculatedAt: new Date('2026-01-01T00:00:00Z'),
} as StockSignalRow;

describe('signals.repository mapping', () => {
  it('maps numeric strings to numbers', () => {
    const signals = rowToSignals(stockSignalRow);
    expect(signals.momentum7d).toBe(1.5);
    expect(signals.opportunityScore).toBe(72.5);
    expect(signals.ticker).toBe('AAPL');
  });

  it('upserts signals atomically on asset id conflict', async () => {
    const returning = jest.fn().mockResolvedValue([stockSignalRow]);
    const onConflictDoUpdate = jest.fn().mockReturnValue({ returning });
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const repository = new SignalsRepository({ insert } as never);

    await expect(
      repository.upsert({
        assetId: 'aapl',
        ticker: 'AAPL',
        momentum7d: 1.5,
        momentum30d: 3.25,
        volatility30d: 2.1,
        volumeTrend: 1.2,
        rsi14: 55.5,
        sma20: 190,
        sma50: 185,
        liquidityScore: 70,
        activityScore: 65,
        opportunityScore: 72.5,
        calculatedAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).resolves.toMatchObject({ assetId: 'aapl', opportunityScore: 72.5 });

    expect(insert).toHaveBeenCalledWith(stockSignals);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: stockSignals.assetId }),
    );
  });
});
