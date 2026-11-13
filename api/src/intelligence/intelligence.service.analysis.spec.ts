import { IntelligenceService } from './intelligence.service';

describe('IntelligenceService analysis', () => {
  it('returns summary and technicalBrief on getAnalysis', async () => {
    const dailyBars = Array.from({ length: 220 }, (_, index) => {
      const close = 100 + Math.sin(index / 8) * 4 + index * 0.08;
      return {
        assetId: 'nvidia',
        timestamp: new Date(Date.UTC(2024, 0, 1 + index)),
        open: close - 0.5,
        high: close + 1.5,
        low: close - 1.5,
        close,
        volume: 1000,
      };
    });

    const tokens = {
      getStock: jest.fn().mockResolvedValue({
        id: 'nvidia',
        ticker: 'NVDA',
        name: 'NVIDIA',
        price: 120,
        variants: [],
      }),
      getCandlesForWindow: jest.fn().mockResolvedValue(dailyBars),
      getOHLCV: jest.fn(),
      getRisk: jest.fn().mockRejectedValue(new Error('no risk')),
    };
    const repository = {
      upsert: jest.fn().mockImplementation(async (signals) => signals),
      getByAssetId: jest.fn(),
      listByMinScore: jest.fn(),
    };
    const catalog = { findByAssetIds: jest.fn() };
    const news = {
      getEquityNews: jest.fn().mockResolvedValue({
        assetId: 'nvidia',
        items: [
          {
            headline: 'NVIDIA shares fall on guidance',
            publishedAt: new Date(),
          },
        ],
      }),
    };

    const service = new IntelligenceService(
      tokens as never,
      repository as never,
      catalog as never,
      news as never,
    );

    const analysis = await service.getAnalysis('nvidia');

    expect(analysis.summary).toContain('NVDA');
    expect(analysis.technicalBrief?.primaryTimeframe.timeframe).toBe('daily');
    expect(analysis.technicalBrief?.levels.length).toBeGreaterThan(0);
    expect(repository.upsert).toHaveBeenCalled();
    expect(tokens.getCandlesForWindow).toHaveBeenCalled();
    expect(news.getEquityNews).toHaveBeenCalledWith('nvidia', { limit: 3 });
  });
});
