import { Logger } from '@nestjs/common';
import type { AppEnv } from '../config/env.schema';
import { DripService } from './drip.service';

const API_KEY = 'pk_drip_test_secret';

function env(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    DRIP_ENABLED: true,
    DRIP_PUBLIC_RESEARCH_ENABLED: true,
    DRIP_API_KEY: API_KEY,
    DRIP_API_BASE_URL: 'https://dripstack.test',
    DRIP_REQUEST_TIMEOUT_MS: 12_000,
    ...overrides,
  } as AppEnv;
}

const nvda = {
  id: 'nvda',
  ticker: 'NVDA',
  name: 'NVIDIA',
  category: 'equity' as const,
  variants: [
    {
      mint: 'mint',
      symbol: 'NVDAx',
      name: 'NVIDIA xStock',
      tradable: true,
    },
  ],
};

describe('DripService', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  const market = {
    getStock: jest.fn(),
    searchStocks: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock as typeof fetch;
    market.getStock.mockImplementation((query: string) => {
      if (query === 'NVDA' || query === 'nvda') return Promise.resolve(nvda);
      return Promise.reject(new Error('miss'));
    });
    market.searchStocks.mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps an xStock symbol, caches the ticker, and omits the API key from logs', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    fetchMock
      .mockResolvedValueOnce(tickerResponse())
      .mockRejectedValueOnce(new Error(`socket hang up ${API_KEY}`));
    const service = new DripService(env(), market as never);

    const first = await service.getOpinions('NVDAx', 4);
    const second = await service.getOpinions('NVDA', 4);
    expect(first).toMatchObject({
      available: true,
      queried: 'NVDAx',
      ticker: 'NVDA',
      mappedFrom: 'NVDAx',
      opinions: [
        expect.objectContaining({
          author: 'Example Analyst',
          stance: 'BULLISH',
          url: 'https://example.com/nvda',
        }),
      ],
    });
    expect(second).toMatchObject({
      available: true,
      queried: 'NVDA',
      ticker: 'NVDA',
    });
    expect(second).not.toHaveProperty('mappedFrom');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock.mock.calls as Array<[URL]>)[0][0];
    expect(url.pathname).toBe('/api/v2/tickers/NVDA');
    expect(String(url)).not.toContain(API_KEY);

    const failed = await service.getPicks();
    expect(failed).toMatchObject({
      available: false,
      reason: 'DRIP_UNAVAILABLE',
    });
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(API_KEY);
    warn.mockRestore();
  });

  it('returns an empty opinion list on 404 and does not throw when Drip is down', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () =>
        Promise.resolve(JSON.stringify({ error: 'none', code: 'not_found' })),
    });
    const service = new DripService(env(), market as never);
    await expect(service.getOpinions('NVDA')).resolves.toMatchObject({
      available: true,
      ticker: 'NVDA',
      opinions: [],
      summary: { calls: 0 },
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: () => Promise.resolve(JSON.stringify({ error: 'allowance' })),
    });
    await expect(service.getPicks()).resolves.toMatchObject({
      available: false,
      reason: 'DRIP_RATE_LIMITED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not call Drip when the key is unset', async () => {
    const service = new DripService(
      env({ DRIP_API_KEY: undefined }),
      market as never,
    );
    await expect(service.getOpinions('NVDA')).resolves.toMatchObject({
      available: false,
      reason: 'DRIP_UNSET',
    });
    await expect(service.getPicks()).resolves.toMatchObject({
      reason: 'DRIP_UNSET',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gates tool registration on both flags and verified caller identity', () => {
    const service = new DripService(env(), market as never);
    expect(service.enabledFor({ walletAddress: 'wallet-owner' })).toBe(false);
    expect(service.enabledFor({ email: 'OWNER@example.com' })).toBe(false);
    expect(service.enabledFor({ userId: 'did:privy:owner' })).toBe(false);
    expect(
      service.enabledFor({
        userId: 'did:privy:owner',
        walletAddress: 'wallet-owner',
      }),
    ).toBe(true);
    expect(service.enabledFor({ walletAddress: 'someone-else' })).toBe(false);
    const disabled = new DripService(
      env({ DRIP_ENABLED: false }),
      market as never,
    );
    expect(
      disabled.enabledFor({
        userId: 'did:privy:owner',
        walletAddress: 'wallet-owner',
      }),
    ).toBe(false);
    const privateResearch = new DripService(
      env({ DRIP_PUBLIC_RESEARCH_ENABLED: false }),
      market as never,
    );
    expect(
      privateResearch.enabledFor({
        userId: 'did:privy:owner',
        walletAddress: 'wallet-owner',
      }),
    ).toBe(false);
  });

  it('returns a rate-limit result before contacting Drip when quota is exhausted', async () => {
    const quota = { claim: jest.fn().mockResolvedValue(false) };
    const service = new DripService(env(), market as never, quota as never);
    await expect(
      service.getOpinions('NVDA', 8, { userId: 'did:privy:owner' }),
    ).resolves.toMatchObject({ available: false, reason: 'DRIP_RATE_LIMITED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function tickerResponse() {
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({
          meta: {
            ticker: 'NVDA',
            from: '2026-10-01',
            to: '2026-10-31',
            asOf: '2026-11-01T00:00:00.000Z',
            truncated: false,
          },
          summary: {
            calls: 1,
            analysts: 1,
            bullish: 1,
            bearish: 0,
            neutral: 0,
            byAction: { ADD: 1 },
          },
          authors: [
            {
              author: 'Example Analyst',
              mentions: [
                {
                  sentiment: 'BULLISH',
                  action: 'ADD',
                  evidenceQuote: 'Adding to NVDA.',
                  articleTitle: 'Example Newsletter',
                  articleUrl: 'https://example.com/nvda',
                  publishedAt: '2026-10-30T00:00:00.000Z',
                  thesis: 'Adds on a pullback.',
                },
              ],
            },
          ],
        }),
      ),
  };
}
