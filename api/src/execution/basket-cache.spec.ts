import { BasketExpiredError } from '../common/errors/provider.errors';
import { BASKET_TTL_MS } from '../config/constants';
import { BasketCache } from './basket-cache';

describe('BasketCache', () => {
  const basket = {
    id: 'basket-1',
    totalAmountUsd: 100,
    allocations: [],
    createdAt: new Date(),
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns stored baskets before expiry', () => {
    const cache = new BasketCache();
    cache.set(basket);

    expect(cache.get('basket-1')).toBe(basket);
  });

  it('rejects expired baskets', () => {
    jest.useFakeTimers();
    const cache = new BasketCache();
    cache.set(basket);

    jest.advanceTimersByTime(BASKET_TTL_MS + 1);

    expect(() => cache.get('basket-1')).toThrow(BasketExpiredError);
  });
});
