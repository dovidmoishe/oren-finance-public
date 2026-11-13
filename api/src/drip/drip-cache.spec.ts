import { DRIP_PICKS_TTL_MS, DRIP_TICKER_TTL_MS } from '../config/constants';
import { TtlCache } from './drip-cache';

describe('TtlCache', () => {
  it('reuses a fresh ticker entry for 20 minutes and a picks entry for 5', async () => {
    let now = 0;
    const cache = new TtlCache(() => now);
    const load = jest.fn(() => Promise.resolve('nvda'));

    await expect(
      cache.getOrLoad('ticker:NVDA', DRIP_TICKER_TTL_MS, load),
    ).resolves.toBe('nvda');
    now = DRIP_TICKER_TTL_MS - 1;
    await expect(
      cache.getOrLoad('ticker:NVDA', DRIP_TICKER_TTL_MS, load),
    ).resolves.toBe('nvda');
    now = DRIP_TICKER_TTL_MS;
    await expect(
      cache.getOrLoad('ticker:NVDA', DRIP_TICKER_TTL_MS, load),
    ).resolves.toBe('nvda');
    expect(load).toHaveBeenCalledTimes(2);

    const picks = jest.fn(() => Promise.resolve(['a']));
    now = 0;
    await cache.getOrLoad('picks:latest', DRIP_PICKS_TTL_MS, picks);
    now = DRIP_PICKS_TTL_MS;
    await cache.getOrLoad('picks:latest', DRIP_PICKS_TTL_MS, picks);
    expect(picks).toHaveBeenCalledTimes(2);
    expect(DRIP_TICKER_TTL_MS).toBe(20 * 60 * 1000);
    expect(DRIP_PICKS_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('shares one load across concurrent misses and does not store failures', async () => {
    const cache = new TtlCache();
    let release: (value: string) => void = () => undefined;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const load = jest.fn(() => gate);

    const first = cache.getOrLoad('ticker:AAPL', DRIP_TICKER_TTL_MS, load);
    const second = cache.getOrLoad('ticker:AAPL', DRIP_TICKER_TTL_MS, load);
    release('ok');
    await expect(first).resolves.toBe('ok');
    await expect(second).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(1);

    const failing = jest.fn(() => Promise.reject(new Error('down')));
    await expect(
      cache.getOrLoad('ticker:FAIL', DRIP_TICKER_TTL_MS, failing),
    ).rejects.toThrow('down');
    await expect(
      cache.getOrLoad('ticker:FAIL', DRIP_TICKER_TTL_MS, failing),
    ).rejects.toThrow('down');
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
