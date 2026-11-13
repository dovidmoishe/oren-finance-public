import type { TokensService } from '../tokens/tokens.service';
import type { StockCatalogRepository } from '../tokens/stock-catalog.repository';
import { MarketService } from './market.service';

describe('MarketService', () => {
  it('requests only the selected stock page and returns pagination metadata', async () => {
    const getStocksPage = jest.fn().mockResolvedValue({
      stocks: [
        {
          id: 'nvidia',
          ticker: 'NVDA',
          name: 'NVIDIA',
          category: 'equity',
          logo: 'https://cdn.tokens.xyz/nvidia.png',
          price: 182.14,
          priceChange24h: 2.35,
          volume24h: 12_000_000,
          liquidity: 4_500_000,
          variants: [],
        },
      ],
      total: 41,
      hasMore: true,
    });
    const tokens = {
      getStocksPage,
      getStocks: jest.fn().mockResolvedValue([]),
    } as unknown as TokensService;
    const catalog = {
      listPage: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        isFresh: false,
      }),
      replaceAll: jest.fn(),
    } as unknown as StockCatalogRepository;
    const service = new MarketService(tokens, catalog);

    await expect(service.listStocks(2, 20)).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: 'nvidia',
          logo: 'https://cdn.tokens.xyz/nvidia.png',
          volume24h: 12_000_000,
          liquidity: 4_500_000,
        }),
      ],
      pagination: {
        page: 2,
        limit: 20,
        total: 41,
        totalPages: 3,
        hasMore: true,
      },
    });
    expect(getStocksPage).toHaveBeenCalledWith(20, 20);
  });

  it('serves a fresh stock page from Postgres without calling Tokens', async () => {
    const getStocksPage = jest.fn();
    const tokens = { getStocksPage } as unknown as TokensService;
    const catalog = {
      listPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'apple',
            ticker: 'AAPL',
            name: 'Apple',
            category: 'equity',
          },
        ],
        total: 34,
        isFresh: true,
      }),
    } as unknown as StockCatalogRepository;
    const service = new MarketService(tokens, catalog);

    await expect(service.listStocks(1, 20)).resolves.toMatchObject({
      items: [{ id: 'apple', ticker: 'AAPL' }],
      pagination: { total: 34, hasMore: true },
    });
    expect(getStocksPage).not.toHaveBeenCalled();
  });
});
