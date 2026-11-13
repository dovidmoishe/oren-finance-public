jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
import { VaultController } from './vault.controller';

describe('VaultController', () => {
  const auth = { requireWallet: jest.fn().mockResolvedValue('user-1') };

  it('delegates prepare-lock to VaultService', async () => {
    const vault = {
      prepareLock: jest.fn().mockResolvedValue({
        wallet: 'wallet',
        transaction: 'base64',
      }),
    };
    const controller = new VaultController(vault as never, auth as never);

    await expect(
      controller.prepareLock({
        action: 'lock',
        wallet: 'wallet',
        asset: 'NVDA',
        amount: 1,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      }),
    ).resolves.toEqual({
      wallet: 'wallet',
      transaction: 'base64',
    });
  });

  it('delegates confirm-unlock to VaultService', async () => {
    const vault = {
      confirmUnlock: jest.fn().mockResolvedValue({
        wallet: 'wallet',
        lockAddress: 'lockbox',
        signature: 'sig',
        status: 'confirmed',
        portfolioRefreshed: true,
      }),
    };
    const controller = new VaultController(vault as never, auth as never);

    await expect(
      controller.confirmUnlock('Bearer token', {
        wallet: 'wallet',
        lockAddress: 'lockbox',
        signature: 'sig',
      }),
    ).resolves.toEqual({
      wallet: 'wallet',
      lockAddress: 'lockbox',
      signature: 'sig',
      status: 'confirmed',
      portfolioRefreshed: true,
    });
  });

  it('refuses confirm routes for callers who do not own the wallet', async () => {
    const vault = { confirmLock: jest.fn(), confirmUnlock: jest.fn() };
    const denied = new Error('Wallet is not linked to this account');
    auth.requireWallet.mockRejectedValueOnce(denied).mockRejectedValueOnce(denied);
    const controller = new VaultController(vault as never, auth as never);

    await expect(
      controller.confirmUnlock(undefined, {
        wallet: 'victim',
        lockAddress: 'lockbox',
        signature: 'sig',
      }),
    ).rejects.toBe(denied);
    await expect(
      controller.confirmLock(undefined, {
        wallet: 'victim',
        lockAddress: 'lockbox',
        signature: 'sig',
        mint: 'mint',
        amount: 1,
        unlockAt: new Date(),
      }),
    ).rejects.toBe(denied);
    expect(vault.confirmUnlock).not.toHaveBeenCalled();
    expect(vault.confirmLock).not.toHaveBeenCalled();
  });
});
