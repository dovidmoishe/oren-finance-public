import { TokensService } from './tokens.service';

describe('TokensService candle fetching', () => {
  it('falls back to OHLCV with the best tradable mint when price-chart is empty', async () => {
    const client = {
      get: jest
        .fn()
        .mockResolvedValueOnce({ candles: [] })
        .mockResolvedValueOnce({
          assetId: 'cost',
          ticker: 'COST',
          category: 'equity',
          variants: [
            {
              mint: 'mint-cost',
              symbol: 'COST',
              tradable: true,
              liquidity: 100000,
            },
          ],
        })
        .mockResolvedValueOnce({
          candles: [
            {
              timestamp: 1_700_000_000,
              open: 900,
              high: 905,
              low: 895,
              close: 902,
              volume: 1000,
            },
          ],
        }),
    };

    const service = new TokensService(client as never);
    const candles = await service.getCandlesForWindow('cost', {
      interval: '1D',
      from: 1_600_000_000,
      to: 1_700_000_000,
    });

    expect(candles).toHaveLength(1);
    expect(client.get).toHaveBeenCalledTimes(3);
    expect(client.get).toHaveBeenNthCalledWith(
      3,
      '/assets/cost/ohlcv',
      expect.objectContaining({
        interval: '1D',
        mint: 'mint-cost',
      }),
    );
  });
});
