import type { CachedStockRow } from './stock-catalog.repository';
import { rowToStockSummary } from './stock-catalog.repository';

describe('stock catalog repository mapping', () => {
  it('maps persisted numeric values into a stock summary', () => {
    const row = {
      assetId: 'nvidia',
      ticker: 'NVDA',
      name: 'NVIDIA',
      category: 'equity',
      logo: 'https://cdn.tokens.xyz/nvidia.png',
      price: '182.14',
      priceChange24h: '2.35',
      volume24h: '12000000',
      liquidity: '4500000',
      sortRank: 0,
      cachedAt: new Date('2026-09-13T06:00:00Z'),
      expiresAt: new Date('2026-09-13T06:01:00Z'),
    } satisfies CachedStockRow;

    expect(rowToStockSummary(row)).toEqual({
      id: 'nvidia',
      ticker: 'NVDA',
      name: 'NVIDIA',
      category: 'equity',
      logo: 'https://cdn.tokens.xyz/nvidia.png',
      price: 182.14,
      priceChange24h: 2.35,
      volume24h: 12_000_000,
      liquidity: 4_500_000,
    });
  });
});
