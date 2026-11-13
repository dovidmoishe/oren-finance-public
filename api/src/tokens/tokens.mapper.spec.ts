import {
  extractCandles,
  mapCandles,
  mapEquity,
  mapEquityList,
} from './tokens.mapper';

describe('tokens mapper', () => {
  it('maps the curated asset image and canonical stats', () => {
    const equity = mapEquity({
      assetId: 'nvidia',
      symbol: 'NVDA',
      name: 'NVIDIA',
      category: 'equity',
      imageUrl: 'https://cdn.tokens.xyz/nvidia.png',
      stats: {
        price: 182.14,
        priceChange24hPercent: 2.35,
        volume24hUSD: 12_000_000,
        liquidity: 4_500_000,
      },
    });

    expect(equity).toMatchObject({
      id: 'nvidia',
      ticker: 'NVDA',
      logo: 'https://cdn.tokens.xyz/nvidia.png',
      price: 182.14,
      priceChange24h: 2.35,
      volume24h: 12_000_000,
      liquidity: 4_500_000,
    });
  });

  it('falls back to the primary variant logo', () => {
    const equity = mapEquity({
      assetId: 'tesla',
      symbol: 'TSLA',
      primaryVariant: {
        mint: 'mint',
        market: { logoURI: 'ipfs://tesla-logo' },
      },
    });

    expect(equity.logo).toBe('ipfs://tesla-logo');
  });

  it('keeps explicit equities and rejects unrelated assets leaked by curated lists', () => {
    const equities = mapEquityList([
      {
        assetId: 'nvidia',
        symbol: 'NVDA',
        name: 'NVIDIA',
        category: 'equity',
      },
      {
        assetId: 'spacex',
        symbol: 'SPCX',
        name: 'SpaceX',
        primaryVariant: {
          mint: 'spacex-mint',
          kind: 'tokenized_equity',
        },
      },
      {
        assetId: 'zcash',
        symbol: 'ZEC',
        name: 'Zcash',
        category: 'cryptocurrency',
      },
      {
        assetId: 'runescape-gold',
        symbol: 'GP',
        name: 'RuneScape Gold',
      },
    ]);

    expect(equities.map((equity) => equity.id)).toEqual([
      'nvidia',
      'spacex',
    ]);
  });

  it('maps tuple OHLCV candles from nested provider envelopes', () => {
    const candles = mapCandles(
      extractCandles({
        chart: {
          ohlcv: [[1_789_000_000, 100, 105, 99, 104, 12_000]],
        },
      }),
    );

    expect(candles).toEqual([
      {
        timestamp: new Date(1_789_000_000 * 1000),
        open: 100,
        high: 105,
        low: 99,
        close: 104,
        volume: 12_000,
      },
    ]);
  });

  it('maps price pairs into flat candles', () => {
    const candles = mapCandles(
      extractCandles({
        prices: [[1_789_000_000_000, 166.05]],
      }),
    );

    expect(candles).toEqual([
      {
        timestamp: new Date(1_789_000_000_000),
        open: 166.05,
        high: 166.05,
        low: 166.05,
        close: 166.05,
        volume: undefined,
      },
    ]);
  });

  it('maps ISO timestamp and string OHLCV values', () => {
    const candles = mapCandles(
      extractCandles({
        data: [
          {
            timestamp: '2026-09-14T12:00:00Z',
            open: '101.10',
            high: '102.50',
            low: '100.90',
            close: '101.44',
            volume_quote_usd: '125037.50',
          },
        ],
      }),
    );

    expect(candles).toEqual([
      {
        timestamp: new Date('2026-09-14T12:00:00Z'),
        open: 101.1,
        high: 102.5,
        low: 100.9,
        close: 101.44,
        volume: 125037.5,
      },
    ]);
  });
});
