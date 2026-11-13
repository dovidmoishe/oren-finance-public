import { rowToNewsItem, type CachedNewsRow } from './news.repository';

describe('news.repository mapping', () => {
  it('maps cached_news rows back to MarketNewsItem', () => {
    const row = {
      id: 'cache-1',
      assetId: 'nvda',
      headline: 'Nvidia moves higher',
      source: 'Market Desk',
      summary: 'Chip stocks rallied.',
      url: 'https://example.com/nvda',
      publishedAt: new Date('2026-09-13T10:00:00Z'),
      payload: {
        id: 'story-1',
        assetId: 'nvda',
        ticker: 'NVDA',
        imageUrl: 'https://example.com/image.jpg',
        publishedAt: '2026-09-13T10:00:00.000Z',
      },
      cachedAt: new Date('2026-09-13T10:01:00Z'),
      expiresAt: new Date('2026-09-13T10:11:00Z'),
    } as CachedNewsRow;

    expect(rowToNewsItem(row)).toEqual({
      id: 'story-1',
      assetId: 'nvda',
      ticker: 'NVDA',
      headline: 'Nvidia moves higher',
      source: 'Market Desk',
      summary: 'Chip stocks rallied.',
      url: 'https://example.com/nvda',
      publishedAt: new Date('2026-09-13T10:00:00Z'),
      imageUrl: 'https://example.com/image.jpg',
    });
  });
});
