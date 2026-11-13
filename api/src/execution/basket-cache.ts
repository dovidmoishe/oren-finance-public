import { Injectable } from '@nestjs/common';
import type { Basket } from '../../types/execution';
import { BASKET_TTL_MS } from '../config/constants';
import { BasketExpiredError } from '../common/errors/provider.errors';

interface CachedBasketEntry {
  basket: Basket;
  storedAt: number;
}

@Injectable()
export class BasketCache {
  private readonly baskets = new Map<string, CachedBasketEntry>();

  set(basket: Basket): void {
    this.baskets.set(basket.id, {
      basket,
      storedAt: Date.now(),
    });
  }

  get(basketId: string): Basket {
    const entry = this.baskets.get(basketId);
    if (!entry) {
      throw new BasketExpiredError(
        `Basket not found: ${basketId}. Create a fresh basket and try again.`,
      );
    }
    if (Date.now() - entry.storedAt > BASKET_TTL_MS) {
      this.baskets.delete(basketId);
      throw new BasketExpiredError(
        `Basket expired: ${basketId}. Create a fresh basket and try again.`,
      );
    }
    return entry.basket;
  }
}
