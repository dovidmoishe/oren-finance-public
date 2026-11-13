import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { USDC_MINT } from '../config/constants';
import type { FundingRpc } from './funding-rpc.service';
import type { FundingEvent } from './funding.types';

/** One upstream WebSocket per watched wallet. Reconnects belong to the client;
 * every new connection must authenticate again and obtains a fresh snapshot. */
export class FundingFeed {
  private readonly pending = new Map<number, string>();
  private readonly subscriptions = new Set<number>();
  private readonly watched = new Set<string>();
  private readonly socket: WebSocket;
  private id = 0;
  private minSlot = 0;
  private deliveredSlot = 0;
  private stopped = false;
  private readonly abort = new AbortController();
  private busy = false;
  private dirty = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly wallet: string,
    private readonly rpc: FundingRpc,
    private readonly emit: (event: FundingEvent) => void,
    private readonly fail: () => void,
    socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    this.socket = socketFactory(rpc.websocketUrl);
    this.armDeadline();
    this.socket.addEventListener('open', () => {
      if (this.stopped) return;
      try {
        this.subscribeAccount(wallet);
        // The owner+mint filter discovers the FIRST token account as well as
        // non-associated USDC accounts. Per-account subscriptions track closures.
        this.subscribe('programSubscribe', TOKEN_PROGRAM_ID.toBase58(), {
          encoding: 'jsonParsed',
          commitment: 'confirmed',
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: USDC_MINT } },
            { memcmp: { offset: 32, bytes: wallet } },
          ],
        });
        this.subscribeAccount(rpc.associatedAccount(wallet));
      } catch {
        this.stopWithError();
      }
    });
    this.socket.addEventListener('message', (event) =>
      this.onMessage(event.data),
    );
    this.socket.addEventListener('error', () => this.stopWithError());
    this.socket.addEventListener('close', () => this.stopWithError());
  }

  close() {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    clearTimeout(this.deadline);
    clearTimeout(this.refreshTimer);
    // Closing a socket releases its subscriptions, including pending requests.
    try {
      this.socket.close();
    } catch {
      /* Already closed. */
    }
  }

  get live() {
    return this.deliveredSlot > 0 && !this.stopped && !this.pending.size;
  }

  private armDeadline() {
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this.stopWithError(), 15_000);
  }

  private subscribe(method: string, address: string, config: object) {
    const id = ++this.id;
    this.pending.set(id, address);
    this.socket.send(
      JSON.stringify({ jsonrpc: '2.0', id, method, params: [address, config] }),
    );
    this.armDeadline();
  }

  private subscribeAccount(address: string): boolean {
    if (this.watched.has(address)) return false;
    if (this.watched.size >= 128)
      throw new Error('Subscription capacity reached');
    this.watched.add(address);
    this.subscribe('accountSubscribe', address, {
      encoding: 'base64',
      commitment: 'confirmed',
    });
    return true;
  }

  private onMessage(raw: unknown) {
    if (this.stopped) return;
    try {
      if (typeof raw !== 'string' || raw.length > 1_000_000)
        throw new Error('Invalid subscription response');
      const event = JSON.parse(raw) as {
        id?: number;
        error?: unknown;
        result?: number;
        method?: string;
        params?: {
          subscription: number;
          result?: { context?: { slot?: number } };
        };
      };
      if (event.id !== undefined && this.pending.has(event.id)) {
        if (
          event.error ||
          !Number.isSafeInteger(event.result) ||
          event.result! < 0
        )
          throw new Error('Subscription rejected');
        this.pending.delete(event.id);
        this.subscriptions.add(event.result!);
        if (!this.pending.size) {
          clearTimeout(this.deadline);
          this.requestRefresh();
        }
      } else if (
        (event.method === 'accountNotification' ||
          event.method === 'programNotification') &&
        event.params &&
        this.subscriptions.has(event.params.subscription)
      ) {
        const slot = event.params.result?.context?.slot;
        if (!Number.isSafeInteger(slot) || slot! < 0)
          throw new Error('Invalid subscription slot');
        this.minSlot = Math.max(this.minSlot, slot!);
        this.requestRefresh();
      }
    } catch {
      this.stopWithError();
    }
  }

  private requestRefresh() {
    this.dirty = true;
    if (this.stopped || this.busy || this.pending.size || this.refreshTimer)
      return;
    // Coalesce a transfer's SOL and token notifications into one snapshot read.
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 100);
  }

  private async refresh() {
    if (this.stopped || this.busy || this.pending.size) return;
    this.busy = true;
    this.dirty = false;
    try {
      const result = await this.rpc.snapshot(
        this.wallet,
        this.minSlot,
        this.abort.signal,
      );
      if (this.stopped) return;
      let added = false;
      for (const address of result.accounts)
        added = this.subscribeAccount(address) || added;
      if (
        added ||
        result.data.slot < this.minSlot ||
        result.data.slot < this.deliveredSlot
      ) {
        this.dirty = true;
      } else {
        this.deliveredSlot = result.data.slot;
        this.emit({ type: 'snapshot', data: result.data });
        this.emit({ type: 'status', status: 'live' });
      }
    } catch {
      this.stopWithError();
    } finally {
      this.busy = false;
      if (this.dirty && !this.stopped) this.requestRefresh();
    }
  }

  private stopWithError() {
    if (this.stopped) return;
    this.close();
    // Never forward provider errors: they may contain credential-bearing URLs.
    this.emit({
      type: 'error',
      message: 'Live balance updates are unavailable. Reconnecting…',
    });
    this.fail();
  }
}
