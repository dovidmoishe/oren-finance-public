import { IntelligenceService } from './intelligence.service';

describe('IntelligenceService opportunities', () => {
  it('ranks persisted signals without refreshing every stock from Tokens', async () => {
    const tokens = {
      getStocks: jest.fn(),
      getStock: jest.fn(),
      getOHLCV: jest.fn(),
    };
    const repository = {
      listByMinScore: jest.fn().mockResolvedValue([
        {
          assetId: 'nvidia',
          ticker: 'NVDA',
          momentum7d: 1,
          momentum30d: 2,
          volatility30d: 3,
          volumeTrend: 1,
          rsi14: 55,
          sma20: 180,
          sma50: 170,
          liquidityScore: 80,
          activityScore: 75,
          opportunityScore: 82,
          calculatedAt: new Date(),
        },
      ]),
    };
    const catalog = {
      findByAssetIds: jest.fn().mockResolvedValue([
        {
          id: 'nvidia',
          ticker: 'NVDA',
          name: 'NVIDIA',
          category: 'equity',
          price: 182,
          priceChange24h: 2.4,
        },
      ]),
    };
    const news = { getEquityNews: jest.fn() };
    const service = new IntelligenceService(
      tokens as never,
      repository as never,
      catalog as never,
      news as never,
    );

    await expect(service.getOpportunities()).resolves.toEqual([
      expect.objectContaining({
        assetId: 'nvidia',
        name: 'NVIDIA',
        opportunityScore: 82,
      }),
    ]);
    expect(catalog.findByAssetIds).toHaveBeenCalledWith(['nvidia']);
    expect(tokens.getStocks).not.toHaveBeenCalled();
    expect(tokens.getStock).not.toHaveBeenCalled();
    expect(tokens.getOHLCV).not.toHaveBeenCalled();
  });
});
