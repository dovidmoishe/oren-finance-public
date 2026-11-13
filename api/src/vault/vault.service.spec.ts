import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { VaultService, VAULT_PROGRAM_NOT_LIVE } from './vault.service';

const wallet = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';

describe('VaultService', () => {
  const repository = {
    listByOwner: jest.fn(),
    findByOwnerAndLockAddress: jest.fn(),
    upsertLock: jest.fn(),
    removeLock: jest.fn(),
    recordExecution: jest.fn(),
  };
  const builder = {
    getTokenProgramId: jest.fn(),
    buildLock: jest.fn(),
    buildUnlock: jest.fn(),
  };
  const alchemy = {
    getTokenAccounts: jest.fn(),
    getTransactionStatus: jest.fn(),
  };
  const portfolio = {
    getPortfolio: jest.fn(),
  };
  const tokens = {
    getMarketSnapshots: jest.fn(),
    resolveMint: jest.fn(),
  };
  const env = {
    VAULT_PROGRAM_LIVE: true,
  };


  let service: VaultService;

  beforeEach(() => {
    jest.clearAllMocks();
    env.VAULT_PROGRAM_LIVE = true;
    service = new VaultService(
      repository as never,
      builder as never,
      alchemy as never,
      portfolio as never,
      tokens as never,
      env as never,
    );
  });

  it('prepares a lock for a held variant', async () => {
    portfolio.getPortfolio.mockResolvedValue({
      positions: [
        {
          assetId: 'nvda',
          ticker: 'NVDA',
          name: 'NVIDIA',
          variants: [
            {
              variant: { mint, symbol: 'NVDAx', name: 'NVIDIA', tradable: true },
              availableAmount: 2,
            },
          ],
        },
      ],
    });
    alchemy.getTokenAccounts.mockResolvedValue([
      {
        address: 'acct',
        mint,
        amount: 2_000_000,
        decimals: 6,
        uiAmount: 2,
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      },
    ]);
    builder.buildLock.mockResolvedValue({
      transaction: 'base64',
      lockAddress: 'lockbox',
      tokenVaultAddress: 'vault',
    });

    await expect(
      service.prepareLock({
        action: 'lock',
        wallet,
        asset: 'NVDA',
        amount: 1.5,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      }),
    ).resolves.toMatchObject({
      wallet,
      transaction: 'base64',
      mint,
      assetId: 'nvda',
      ticker: 'NVDA',
      amount: 1.5,
    });

    expect(builder.buildLock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountRaw: 1_500_000n,
        userTokenAccount: 'acct',
      }),
    );
  });

  it('rejects early unlock attempts', async () => {
    repository.findByOwnerAndLockAddress.mockResolvedValue({
      lockAddress: wallet,
      owner: wallet,
      mint,
      amount: '1',
      unlockAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.prepareUnlock({
        action: 'unlock',
        wallet,
        lockAddress: wallet,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('includes programLive=false on list when the program is not live', async () => {
    env.VAULT_PROGRAM_LIVE = false;
    repository.listByOwner.mockResolvedValue([]);
    tokens.getMarketSnapshots.mockResolvedValue([]);

    await expect(service.listVaults(wallet)).resolves.toMatchObject({
      walletAddress: wallet,
      totalLockedValueUsd: 0,
      positions: [],
      programLive: false,
    });
  });

  it('returns 503 with VAULT_PROGRAM_NOT_LIVE when preparing a lock while not live', async () => {
    env.VAULT_PROGRAM_LIVE = false;

    await expect(
      service.prepareLock({
        action: 'lock',
        wallet,
        asset: 'NVDA',
        amount: 1,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    try {
      await service.prepareLock({
        action: 'lock',
        wallet,
        asset: 'NVDA',
        amount: 1,
        unlockAt: new Date('2027-01-01T00:00:00Z'),
      });
    } catch (error) {
      const body = (error as ServiceUnavailableException).getResponse() as {
        error?: string;
      };
      expect(body.error).toBe(VAULT_PROGRAM_NOT_LIVE);
    }

    expect(builder.buildLock).not.toHaveBeenCalled();
  });

  it('returns 503 when confirming unlock while not live', async () => {
    env.VAULT_PROGRAM_LIVE = false;

    await expect(
      service.confirmUnlock({
        wallet,
        signature: 'sig',
        lockAddress: wallet,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

});
