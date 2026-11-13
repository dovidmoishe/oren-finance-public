import type { MarketNewsItem } from '../../types/news';
import { NewsService, clampLimit, sortNewestFirst } from './news.service';

const oldItem: MarketNewsItem = {
  headline: 'Old NVDA story',
  publishedAt: new Date('2026-09-13T09:00:00Z'),
};

const newItem: MarketNewsItem = {
  headline: 'New NVIDIA story',
  publishedAt: new Date('2026-09-13T11:00:00Z'),
};

describe('NewsService', () => {
  const tokens = { getNews: jest.fn(), getStock: jest.fn() };
  const portfolio = { getPortfolio: jest.fn() };
  const repository = {
    listFresh: jest.fn(),
    replaceScope: jest.fn(),
  };

  let service: NewsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tokens.getStock.mockResolvedValue({
      id: 'nvda',
      ticker: 'NVDA',
      name: 'NVIDIA',
    });
    service = new NewsService(
      tokens as never,
      portfolio as never,
      repository as never,
    );
  });

  it('returns fresh cached equity news without calling Tokens', async () => {
    repository.listFresh.mockResolvedValue([newItem]);

    await expect(service.getEquityNews('nvda', { limit: 10 })).resolves.toEqual(
      {
        assetId: 'nvda',
        items: [newItem],
      },
    );

    expect(repository.listFresh).toHaveBeenCalledWith(
      'nvda',
      expect.any(Date),
      10,
    );
    expect(tokens.getNews).not.toHaveBeenCalled();
    expect(repository.replaceScope).not.toHaveBeenCalled();
  });

  it('fetches, sorts, caches, and limits equity news on cache miss', async () => {
    repository.listFresh.mockResolvedValue([]);
    tokens.getNews.mockResolvedValue([oldItem, newItem]);

    await expect(service.getEquityNews('nvda', { limit: 1 })).resolves.toEqual({
      assetId: 'nvda',
      items: [newItem],
    });

    expect(tokens.getNews).toHaveBeenCalledWith('nvda');
    expect(repository.replaceScope).toHaveBeenCalledWith(
      'nvda',
      [newItem, oldItem],
      expect.any(Date),
    );
  });

  it('filters unrelated broad market news for an equity feed', async () => {
    const unrelated: MarketNewsItem = {
      headline: 'Bitcoin and Ether perps expand to more venues',
      publishedAt: new Date('2026-09-13T12:00:00Z'),
    };
    repository.listFresh.mockResolvedValue([]);
    tokens.getNews.mockResolvedValue([unrelated, newItem]);

    await expect(service.getEquityNews('nvda', { limit: 10 })).resolves.toEqual(
      {
        assetId: 'nvda',
        items: [newItem],
      },
    );

    expect(repository.replaceScope).toHaveBeenCalledWith(
      'nvda',
      [newItem],
      expect.any(Date),
    );
  });

  it('builds portfolio-aware news context for the agent', async () => {
    portfolio.getPortfolio.mockResolvedValue({
      positions: [
        { assetId: 'nvda' },
        { assetId: 'aapl' },
        { assetId: 'nvda' },
      ],
    });
    repository.listFresh.mockResolvedValue([]);
    tokens.getNews
      .mockResolvedValueOnce([newItem])
      .mockResolvedValueOnce([oldItem]);

    await expect(
      service.getNewsContextForAgent({
        walletAddress: 'wallet-1',
        maxItems: 1,
      }),
    ).resolves.toEqual({
      assetIds: ['nvda', 'aapl'],
      items: [newItem],
      generatedAt: expect.any(Date),
    });
  });
});

describe('news helpers', () => {
  it('clamps limits', () => {
    expect(clampLimit(undefined)).toBe(10);
    expect(clampLimit('bad')).toBe(10);
    expect(clampLimit('999')).toBe(25);
    expect(clampLimit(0)).toBe(1);
  });

  it('sorts newest first', () => {
    expect(sortNewestFirst([oldItem, newItem])).toEqual([newItem, oldItem]);
  });
});
