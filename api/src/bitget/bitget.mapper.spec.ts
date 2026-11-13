import {
  mapBitgetCandles,
  mapBitgetQuote,
  mapBitgetSessions,
} from './bitget.mapper';

describe('Bitget mappers', () => {
  it('normalizes ticker strings, percent change, and spread', () => {
    expect(
      mapBitgetQuote({
        lastPrice: '190.50',
        openPrice24h: '185',
        highPrice24h: '192',
        lowPrice24h: '183',
        bid1Price: '190.40',
        ask1Price: '190.60',
        price24hPcnt: '0.02973',
        volume24h: '1200.5',
        turnover24h: '228000.25',
      }),
    ).toEqual({
      lastPriceUsd: 190.5,
      open24hUsd: 185,
      high24hUsd: 192,
      low24hUsd: 183,
      change24hPct: 2.973,
      volume24h: 1200.5,
      turnover24hUsd: 228000.25,
      bidUsd: 190.4,
      askUsd: 190.6,
      spreadBps: 10.5,
    });
  });

  it('drops malformed candles and sorts valid rows chronologically', () => {
    const candles = mapBitgetCandles([
      ['2000', '11', '13', '10', '12', '20', '240'],
      ['bad', '1', '2', '0', '1', '3', '3'],
      ['1000', '9', '12', '8', '11', '10', '110'],
    ]);

    expect(candles).toEqual([
      {
        timestamp: new Date(1000),
        open: 9,
        high: 12,
        low: 8,
        close: 11,
        volume: 10,
      },
      {
        timestamp: new Date(2000),
        open: 11,
        high: 13,
        low: 10,
        close: 12,
        volume: 20,
      },
    ]);
  });

  it('normalizes the US session schedule', () => {
    expect(
      mapBitgetSessions([
        {
          market: 'US',
          daylightType: 'dst',
          stateList: [
            {
              state: 'regular',
              timeZone: 'ET',
              startTime: '09:30',
              endTime: '16:00',
            },
          ],
        },
      ]),
    ).toEqual({
      daylightType: 'dst',
      sessions: [
        {
          state: 'regular',
          timeZone: 'ET',
          startTime: '09:30',
          endTime: '16:00',
        },
      ],
    });
  });
});
