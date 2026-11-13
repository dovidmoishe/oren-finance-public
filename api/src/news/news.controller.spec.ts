import { NewsController } from './news.controller';

describe('NewsController', () => {
  it('returns stock news using a clamped limit', async () => {
    const news = {
      getEquityNews: jest.fn().mockResolvedValue({
        assetId: 'nvda',
        items: [],
      }),
    };
    const controller = new NewsController(news as never);

    await expect(
      controller.getStockNews('nvda', { limit: '999' }),
    ).resolves.toEqual({
      assetId: 'nvda',
      items: [],
    });

    expect(news.getEquityNews).toHaveBeenCalledWith('nvda', { limit: 25 });
  });

  it('defaults invalid limits instead of failing validation', async () => {
    const news = {
      getEquityNews: jest.fn().mockResolvedValue({
        assetId: 'nvda',
        items: [],
      }),
    };
    const controller = new NewsController(news as never);

    await controller.getStockNews('nvda', { limit: 'nah' });

    expect(news.getEquityNews).toHaveBeenCalledWith('nvda', { limit: 10 });
  });
});
