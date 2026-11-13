import { LimitOrderFillPoller } from './limit-order-fill.poller';

describe('LimitOrderFillPoller Jupiter budget lane', () => {
  it('polls Jupiter on the background lane so it cannot starve user swaps', async () => {
    const trigger = {
      getTriggerOrders: jest.fn().mockResolvedValue({ orders: [] }),
    };
    const orders = {
      listAllOpen: jest
        .fn()
        .mockResolvedValue([{ walletAddress: 'w1', orderKey: 'o1' }]),
    };
    const poller = new LimitOrderFillPoller(
      orders as never,
      {} as never,
      trigger as never,
      {} as never,
    );
    await poller.tick();
    expect(trigger.getTriggerOrders).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'w1', lane: 'background' }),
    );
  });
});
