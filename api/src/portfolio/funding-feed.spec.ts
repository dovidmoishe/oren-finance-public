import { FundingFeed } from './funding-feed';
import type { FundingRpc } from './funding-rpc.service';
import type { FundingEvent, FundingSnapshot } from './funding.types';

class FakeSocket extends EventTarget {
  sent: Array<{ id: number; method: string; params: unknown[] }> = [];
  close = jest.fn();
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as (typeof this.sent)[number]);
  }
  open() {
    this.dispatchEvent(new Event('open'));
  }
  message(data: object) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(data) }),
    );
  }
  acknowledge() {
    for (const request of this.sent)
      this.message({ id: request.id, result: request.id + 100 });
  }
  notify(slot: number, requestId = 2) {
    this.message({
      method: requestId === 2 ? 'programNotification' : 'accountNotification',
      params: { subscription: requestId + 100, result: { context: { slot } } },
    });
  }
}

describe('WebSocket funding lifecycle', () => {
  let socket: FakeSocket;
  let snapshot: jest.Mock;
  let feed: FundingFeed;
  let events: FundingEvent[];
  let fail: jest.Mock;
  const data = (slot = 100, usdcAtomic = '0') =>
    ({ wallet: 'wallet', slot, usdcAtomic }) as FundingSnapshot;

  beforeEach(() => {
    jest.useFakeTimers();
    socket = new FakeSocket();
    events = [];
    fail = jest.fn();
    snapshot = jest.fn().mockResolvedValue({ data: data(), accounts: ['ata'] });
    const rpc = {
      websocketUrl: 'wss://test',
      associatedAccount: () => 'ata',
      snapshot,
    } as unknown as FundingRpc;
    feed = new FundingFeed(
      'wallet',
      rpc,
      (event) => events.push(event),
      fail,
      () => socket as unknown as WebSocket,
    );
  });
  afterEach(() => {
    feed.close();
    jest.useRealTimers();
  });

  it('subscribes before reading and never polls an idle wallet', async () => {
    socket.open();
    expect(snapshot).not.toHaveBeenCalled();
    expect(socket.sent.map((item) => item.method)).toEqual([
      'accountSubscribe',
      'programSubscribe',
      'accountSubscribe',
    ]);
    socket.acknowledge();
    await jest.advanceTimersByTimeAsync(101);
    expect(snapshot).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: 'status', status: 'live' });
  });

  it('discovers the first USDC account and tracks newly discovered accounts for closure', async () => {
    socket.open();
    socket.acknowledge();
    await jest.advanceTimersByTimeAsync(101);
    snapshot.mockResolvedValue({
      data: data(101, '5000000'),
      accounts: ['ata', 'new-account'],
    });
    socket.notify(101);
    await jest.advanceTimersByTimeAsync(101);
    expect(socket.sent.at(-1)?.params[0]).toBe('new-account');
    socket.acknowledge();
    await jest.advanceTimersByTimeAsync(101);
    expect(events).toContainEqual({
      type: 'snapshot',
      data: data(101, '5000000'),
    });
    snapshot.mockResolvedValue({ data: data(102), accounts: ['ata'] });
    socket.notify(102, 4);
    await jest.advanceTimersByTimeAsync(101);
    expect(events).toContainEqual({ type: 'snapshot', data: data(102) });
  });

  it('coalesces notifications and uses their slot as the minimum confirmed snapshot', async () => {
    socket.open();
    socket.acknowledge();
    await jest.advanceTimersByTimeAsync(101);
    snapshot.mockResolvedValue({ data: data(105), accounts: ['ata'] });
    socket.notify(103);
    socket.notify(105);
    socket.notify(104);
    await jest.advanceTimersByTimeAsync(101);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(snapshot).toHaveBeenLastCalledWith(
      'wallet',
      105,
      expect.any(AbortSignal),
    );
  });

  it('discards an in-flight snapshot and aborts upstream reads on cleanup', async () => {
    let finish!: (value: unknown) => void;
    snapshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    socket.open();
    socket.acknowledge();
    await jest.advanceTimersByTimeAsync(101);
    const firstCall = snapshot.mock.calls[0] as unknown[];
    const signal = firstCall[2] as AbortSignal;
    feed.close();
    finish({ data: data(), accounts: ['ata'] });
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(events).toEqual([]);
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('fails and releases resources when a subscription is rejected or never acknowledged', async () => {
    socket.open();
    socket.message({ id: 1, error: { message: 'secret-provider-url' } });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).not.toContain('secret-provider-url');
    expect(socket.close).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
