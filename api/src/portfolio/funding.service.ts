import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import { FundingFeed } from './funding-feed';
import { FundingRpc } from './funding-rpc.service';
import type { FundingEvent } from './funding.types';

@Injectable()
export class FundingService implements OnModuleDestroy {
  private readonly feeds = new Map<
    string,
    { feed: FundingFeed; listeners: Set<Subscriber<FundingEvent>> }
  >();
  constructor(private readonly rpc: FundingRpc) {}

  snapshot(wallet: string) {
    return this.rpc.snapshot(wallet).then((result) => result.data);
  }

  observe(wallet: string): Observable<FundingEvent> {
    return new Observable((subscriber) => {
      const initialRead = new AbortController();
      let entry = this.feeds.get(wallet);
      if (
        (entry?.listeners.size ?? 0) >= 8 ||
        (!entry && this.feeds.size >= 100)
      ) {
        throw new ServiceUnavailableException(
          'Funding updates are busy. Please try again shortly',
        );
      }
      subscriber.next({ type: 'status', status: 'connecting' });
      if (!entry) {
        const listeners = new Set<Subscriber<FundingEvent>>([subscriber]);
        const feed = new FundingFeed(
          wallet,
          this.rpc,
          (event) => {
            for (const listener of listeners) listener.next(event);
          },
          () => {
            this.feeds.delete(wallet);
            for (const listener of [...listeners]) listener.complete();
            listeners.clear();
          },
        );
        entry = { feed, listeners };
        this.feeds.set(wallet, entry);
      } else {
        entry.listeners.add(subscriber);
        // Each viewer gets its own initial confirmed read, even if the shared
        // WebSocket is idle. This is connection-driven, not timed polling.
        void this.rpc
          .snapshot(wallet, 0, initialRead.signal)
          .then((result) => {
            if (!subscriber.closed) {
              subscriber.next({ type: 'snapshot', data: result.data });
              subscriber.next({
                type: 'status',
                status: current.feed.live ? 'live' : 'connecting',
              });
            }
          })
          .catch(() => {
            if (!subscriber.closed)
              subscriber.error(new Error('Unable to load balances'));
          });
      }
      const current = entry;
      return () => {
        initialRead.abort();
        current.listeners.delete(subscriber);
        if (!current.listeners.size) {
          current.feed.close();
          if (this.feeds.get(wallet) === current) this.feeds.delete(wallet);
        }
      };
    });
  }

  onModuleDestroy() {
    for (const entry of this.feeds.values()) {
      entry.feed.close();
      for (const listener of entry.listeners) listener.complete();
    }
    this.feeds.clear();
  }
}
