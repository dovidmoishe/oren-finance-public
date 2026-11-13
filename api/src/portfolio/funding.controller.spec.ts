import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { Request, Response } from 'express';
jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

describe('funding ownership boundary', () => {
  const requireWallet = jest.fn();
  const snapshot = jest.fn();
  const controller = new FundingController(
    {
      requireWallet,
      requireSigner: jest.fn(),
      signTransaction: jest.fn(),
    } as unknown as PrivyWalletAuth,
    {
      snapshot,
    } as unknown as FundingService,
  );
  beforeEach(() => {
    requireWallet.mockReset();
    snapshot.mockReset();
  });
  it('does not read balances for an unauthenticated or unlinked wallet', async () => {
    requireWallet.mockRejectedValue(new Error('forbidden'));
    await expect(
      controller.snapshot('unlinked', 'Bearer token'),
    ).rejects.toThrow('forbidden');
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('verifies ownership before returning a snapshot', async () => {
    requireWallet.mockResolvedValue('user');
    snapshot.mockResolvedValue({ wallet: 'owned' });
    await expect(controller.snapshot('owned', 'Bearer token')).resolves.toEqual(
      { wallet: 'owned' },
    );
    expect(requireWallet).toHaveBeenCalledWith('Bearer token', 'owned');
  });
  it('rejects a stream before sending headers or subscribing to balances', async () => {
    requireWallet.mockRejectedValue(new Error('unlinked wallet'));
    const response = { status: jest.fn(), flushHeaders: jest.fn() };
    await expect(
      controller.stream(
        'unlinked',
        { headers: { authorization: 'Bearer token' } } as Request,
        response as unknown as Response,
      ),
    ).rejects.toThrow('unlinked wallet');
    expect(response.status).not.toHaveBeenCalled();
    expect(response.flushHeaders).not.toHaveBeenCalled();
  });
});
