import type { AppEnv } from '../config/env.schema';
import { BitgetService } from './bitget.service';

const env = {
  PORT: 3000,
  CORS_ORIGIN: '*',
  POSTGRES_URL: 'postgresql://test',
  TOKENS_API_BASE_URL: 'https://tokens.test',
  TOKENS_API_KEY: 'test',
  ALCHEMY_API_KEY: 'test',
  SOLANA_NETWORK: 'mainnet',
  JUPITER_API_URL: 'https://jupiter.test',
  OPENAI_MODEL: 'test',
  BITGET_API_BASE_URL: 'https://api.bitget.test',
  BITGET_REQUEST_TIMEOUT_MS: 1800,
  DRIP_ENABLED: false,
  DRIP_PUBLIC_RESEARCH_ENABLED: false,
  DRIP_API_BASE_URL: 'https://dripstack.com',
  DRIP_REQUEST_TIMEOUT_MS: 12_000,
  VAULT_PROGRAM_ID: 'test',
  VAULT_PROGRAM_LIVE: false,
} as unknown as AppEnv;

describe('BitgetService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves a Reality stock and combines concurrent live context', async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok([
          {
            symbol: 'RNVDAUSDT',
            code: 'NVDA',
            name: 'NVIDIA Corporation',
            tradingPeriod: ['regular', 'after_hours'],
            weekendTradable: 'yes',
          },
        ]),
      )
      .mockResolvedValueOnce(
        ok([
          {
            symbol: 'RNVDAUSDT',
            lastPrice: '191',
            price24hPcnt: '0.01',
            bid1Price: '190.9',
            ask1Price: '191.1',
            turnover24h: '500000',
            ts: '1000',
          },
        ]),
      )
      .mockResolvedValueOnce(
        ok([['1000', '188', '192', '187', '191', '100', '19000']]),
      )
      .mockResolvedValueOnce(
        ok([
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
      );

    const service = new BitgetService(env);
    const context = await service.getMarketContext({
      assetId: 'nvda',
      ticker: 'NVDA',
      referencePriceUsd: 190,
      range: '1D',
    });

    expect(context).toMatchObject({
      available: true,
      assetId: 'nvda',
      ticker: 'NVDA',
      symbol: 'RNVDAUSDT',
      quote: {
        lastPriceUsd: 191,
        change24hPct: 1,
        turnover24hUsd: 500000,
      },
      trading: {
        supportedPeriods: ['regular', 'after_hours'],
        weekendTradable: true,
        daylightType: 'dst',
      },
      comparison: {
        orenReferencePriceUsd: 190,
        bitgetPriceUsd: 191,
        differencePct: 0.5263,
      },
      source: { provider: 'Bitget', product: 'Reality', stale: false },
    });
    expect(context.candles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.slice(1).map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/api/v3/market/tickers'),
        expect.stringContaining('/api/v3/market/candles'),
        expect.stringContaining('/api/v3/reality/market/states'),
      ]),
    );
  });

  it('returns a non-fatal unsupported result when no Bitget market exists', async () => {
    fetchMock
      .mockResolvedValueOnce(ok([]))
      .mockRejectedValueOnce(new Error('unknown ticker'))
      .mockRejectedValueOnce(new Error('unknown candles'))
      .mockResolvedValueOnce(ok([]));
    const service = new BitgetService(env);

    await expect(
      service.getMarketContext({
        assetId: 'unknown',
        ticker: 'UNKNOWN',
      }),
    ).resolves.toMatchObject({
      available: false,
      reason: 'BITGET_REALITY_SYMBOL_UNAVAILABLE',
      source: { provider: 'Bitget', stale: false },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('serves recent stale context when a live refresh fails', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    fetchMock
      .mockResolvedValueOnce(ok([{ symbol: 'RNVDAUSDT', code: 'NVDA' }]))
      .mockResolvedValueOnce(
        ok([{ symbol: 'RNVDAUSDT', lastPrice: '191', ts: '1000' }]),
      )
      .mockResolvedValueOnce(
        ok([['1000', '188', '192', '187', '191', '100', '19000']]),
      )
      .mockResolvedValueOnce(ok([]));

    const service = new BitgetService(env);
    await service.getMarketContext({ assetId: 'nvda', ticker: 'NVDA' });

    now.mockReturnValue(17_000);
    fetchMock.mockRejectedValue(new Error('offline'));
    const stale = await service.getMarketContext({
      assetId: 'nvda',
      ticker: 'NVDA',
    });

    expect(stale.available).toBe(true);
    expect(stale.source.stale).toBe(true);
    expect(stale.quote?.lastPriceUsd).toBe(191);
    expect(stale.warnings).toContain(
      'Live Bitget refresh failed; using recent cached data.',
    );
  });
});

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        code: '00000',
        msg: 'success',
        requestTime: 1000,
        data,
      }),
  };
}
