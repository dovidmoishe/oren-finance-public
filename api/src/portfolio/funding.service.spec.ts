import { FundingService } from './funding.service';
import { FundingFeed } from './funding-feed';
import type { FundingRpc } from './funding-rpc.service';

jest.mock('./funding-feed', () => ({ FundingFeed: jest.fn() }));

describe('shared funding resources', () => {
  const snapshot = jest.fn();
  let service: FundingService;
  let close: jest.Mock;
  beforeEach(() => {
    close = jest.fn();
    jest
      .mocked(FundingFeed)
      .mockReset()
      .mockImplementation(
        () => ({ close, live: true }) as unknown as FundingFeed,
      );
    snapshot
      .mockReset()
      .mockResolvedValue({ data: { wallet: 'wallet', slot: 100 } });
    service = new FundingService({ snapshot } as unknown as FundingRpc);
  });
  afterEach(() => service.onModuleDestroy());

  it('shares the upstream socket until the last viewer leaves', async () => {
    const one = service.observe('wallet').subscribe();
    const two = service.observe('wallet').subscribe();
    await Promise.resolve();
    expect(FundingFeed).toHaveBeenCalledTimes(1);
    one.unsubscribe();
    expect(close).not.toHaveBeenCalled();
    two.unsubscribe();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('aborts a late viewer initial read when it disconnects', () => {
    const one = service.observe('wallet').subscribe();
    const two = service.observe('wallet').subscribe();
    const firstCall = snapshot.mock.calls[0] as unknown[];
    const signal = firstCall[2] as AbortSignal;
    two.unsubscribe();
    expect(signal.aborted).toBe(true);
    expect(close).not.toHaveBeenCalled();
    one.unsubscribe();
  });

  it('bounds viewers per wallet instead of creating unlimited streams', () => {
    const viewers = Array.from({ length: 8 }, () =>
      service.observe('wallet').subscribe(),
    );
    const error = jest.fn();
    service.observe('wallet').subscribe({ error });
    expect(error).toHaveBeenCalledTimes(1);
    expect(FundingFeed).toHaveBeenCalledTimes(1);
    for (const viewer of viewers) viewer.unsubscribe();
  });
});
