import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import bs58 from 'bs58';
import { generateKeyPairSync, sign as ed25519Sign } from 'node:crypto';
import type { UpsertTraderProfileInput } from './social.repository';
import { SocialService } from './social.service';

describe('SocialService', () => {
  const socialRepository = {
    listPublicProfiles: jest.fn(),
    findBySlug: jest.fn(),
    findByWallet: jest.fn(),
    upsertProfile: jest.fn(),
  };
  const portfolioRepository = {
    listSnapshots: jest.fn(),
  };
  const portfolio = {
    getPortfolio: jest.fn(),
    getHistory: jest.fn(),
    getActivity: jest.fn(),
  };
  const execution = {
    createBasketFromAllocations: jest.fn(),
  };

  let service: SocialService;

  const now = Date.now();
  const profileA = profileRow('wallet-a', 'alpha', 'Alpha');
  const profileB = profileRow('wallet-b', 'beta', 'Beta');

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialService(
      socialRepository as never,
      portfolioRepository as never,
      portfolio as never,
      execution as never,
    );
  });

  it('excludes private profiles from the leaderboard source list', async () => {
    socialRepository.listPublicProfiles.mockResolvedValue([profileA]);
    portfolioRepository.listSnapshots.mockResolvedValue([
      snapshot('wallet-a', 150, now),
      snapshot('wallet-a', 100, now - 5 * 86_400_000),
    ]);

    const leaderboard = await service.getLeaderboard({ timeframe: '30D' });

    expect(leaderboard.rows).toHaveLength(1);
    expect(leaderboard.rows[0].slug).toBe('alpha');
    expect(socialRepository.listPublicProfiles).toHaveBeenCalledTimes(1);
  });

  it('ranks 30D observed P&L percentage descending', async () => {
    socialRepository.listPublicProfiles.mockResolvedValue([profileA, profileB]);
    portfolioRepository.listSnapshots.mockImplementation((wallet: string) => {
      if (wallet === 'wallet-a') {
        return Promise.resolve([
          snapshot('wallet-a', 120, now),
          snapshot('wallet-a', 100, now - 10 * 86_400_000),
        ]);
      }
      return Promise.resolve([
        snapshot('wallet-b', 180, now),
        snapshot('wallet-b', 100, now - 10 * 86_400_000),
      ]);
    });

    const leaderboard = await service.getLeaderboard({ timeframe: '30D' });

    expect(leaderboard.rows.map((row) => row.slug)).toEqual(['beta', 'alpha']);
    expect(leaderboard.rows[0].pnlPct).toBe(80);
    expect(leaderboard.rows[1].pnlPct).toBe(20);
  });

  it('ignores idle cash when ranking leaderboard P&L', async () => {
    socialRepository.listPublicProfiles.mockResolvedValue([profileA, profileB]);
    portfolioRepository.listSnapshots.mockImplementation((wallet: string) => {
      if (wallet === 'wallet-a') {
        return Promise.resolve([
          snapshot('wallet-a', 220, now, 120, [
            position('nvda', 'NVDA', 120, 100),
          ]),
          snapshot('wallet-a', 200, now - 10 * 86_400_000, 100, [
            position('nvda', 'NVDA', 100, 100),
          ]),
        ]);
      }
      return Promise.resolve([
        snapshot('wallet-b', 300, now, 150, [
          position('aapl', 'AAPL', 150, 100),
        ]),
        snapshot('wallet-b', 250, now - 10 * 86_400_000, 100, [
          position('aapl', 'AAPL', 100, 100),
        ]),
      ]);
    });

    const leaderboard = await service.getLeaderboard({ timeframe: '30D' });

    expect(leaderboard.rows[0].pnlPct).toBe(50);
    expect(leaderboard.rows[1].pnlPct).toBe(20);
  });

  it('returns a safe 404 for private or missing trader profiles', async () => {
    socialRepository.findBySlug.mockResolvedValue({
      ...profileA,
      isPublic: false,
    });

    await expect(service.getTraderDetail('alpha')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('preserves source portfolio weights when creating copy proposals', async () => {
    socialRepository.findBySlug.mockResolvedValue(profileA);
    portfolioRepository.listSnapshots.mockResolvedValue([
      snapshot('wallet-a', 1000, now, 1000, [
        position('nvda', 'NVDA', 700, 70),
        position('aapl', 'AAPL', 300, 30),
        position('cash', 'CASH', 0, 0),
      ]),
    ]);
    execution.createBasketFromAllocations.mockImplementation((input) => ({
      id: 'basket-1',
      totalAmountUsd: input.totalAmountUsd,
      allocations: input.allocations,
      thesis: input.thesis,
      createdAt: new Date(now),
    }));

    const proposal = await service.prepareCopyPortfolio({
      sourceSlug: 'alpha',
      wallet: 'target-wallet',
      amountUsd: 100,
    });

    expect(proposal.allocations.map((allocation) => allocation.ticker)).toEqual([
      'NVDA',
      'AAPL',
    ]);
    expect(proposal.allocations.map((allocation) => allocation.amountUsd)).toEqual([
      69.6,
      30.4,
    ]);
    expect(proposal.skippedAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: 'CASH' }),
      ]),
    );
  });

  describe('signed profile updates', () => {
    const signer = generateKeyPairSync('ed25519');
    const wallet = bs58.encode(
      signer.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
    );
    const sign = (message: string) =>
      bs58.encode(ed25519Sign(null, Buffer.from(message), signer.privateKey));

    beforeEach(() => {
      socialRepository.findByWallet.mockResolvedValue(null);
      socialRepository.findBySlug.mockResolvedValue(null);
      socialRepository.upsertProfile.mockImplementation(
        (input: UpsertTraderProfileInput) =>
          Promise.resolve({
            ...profileRow(input.walletAddress, input.slug, input.displayName),
            avatarUrl: input.avatarUrl,
            bio: input.bio,
            isPublic: input.isPublic,
          }),
      );
    });

    let clock: jest.SpyInstance | undefined;
    afterEach(() => {
      clock?.mockRestore();
      clock = undefined;
    });

    it('signs every field the update writes', async () => {
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha\nPublic: false',
        slug: 'alpha',
        avatarUrl: 'https://cdn.example.com/a.png',
        bio: 'Long-term holder',
      });

      expect(message).toContain(`Wallet: ${wallet}`);
      expect(message).toContain('Display name: "Alpha\\nPublic: false"');
      expect(message).toContain('Avatar URL: "https://cdn.example.com/a.png"');
      expect(message).toContain('Bio: "Long-term holder"');
      expect(
        message.split('\n').filter((line) => line.startsWith('Public:')),
      ).toEqual(['Public: true']);
    });

    it('writes only the terms the server issued', async () => {
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
        bio: 'Hello',
      });

      await service.updateVisibility(wallet, {
        message,
        signature: sign(message),
      });

      expect(socialRepository.upsertProfile).toHaveBeenCalledWith({
        walletAddress: wallet,
        slug: 'alpha',
        displayName: 'Alpha',
        avatarUrl: null,
        bio: 'Hello',
        isPublic: true,
      });
    });

    it('rejects invalid signed visibility updates without burning the challenge', async () => {
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
      });

      await expect(
        service.updateVisibility(wallet, {
          message,
          signature: 'bad-signature',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(socialRepository.upsertProfile).not.toHaveBeenCalled();

      await service.updateVisibility(wallet, {
        message,
        signature: sign(message),
      });
      expect(socialRepository.upsertProfile).toHaveBeenCalledTimes(1);
    });

    it('rejects a replayed update', async () => {
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
      });
      const signature = sign(message);

      await service.updateVisibility(wallet, { message, signature });
      await expect(
        service.updateVisibility(wallet, { message, signature }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(socialRepository.upsertProfile).toHaveBeenCalledTimes(1);
    });

    it('rejects an expired challenge', async () => {
      const issuedAt = Date.now();
      clock = jest.spyOn(Date, 'now').mockReturnValue(issuedAt);
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
      });

      clock.mockReturnValue(issuedAt + 5 * 60_000 + 1);
      await expect(
        service.updateVisibility(wallet, { message, signature: sign(message) }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(socialRepository.upsertProfile).not.toHaveBeenCalled();
    });

    it('rejects a tampered message even when the wallet signed it', async () => {
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
      });
      const tampered = message.replace('Public: true', 'Public: false');

      await expect(
        service.updateVisibility(wallet, {
          message: tampered,
          signature: sign(tampered),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(socialRepository.upsertProfile).not.toHaveBeenCalled();
    });

    it('rejects a challenge submitted for a different wallet', async () => {
      const other = '11111111111111111111111111111111';
      const { message } = await service.createVisibilityChallenge(wallet, {
        isPublic: true,
        displayName: 'Alpha',
        slug: 'alpha',
      });

      await expect(
        service.updateVisibility(other, { message, signature: sign(message) }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(socialRepository.upsertProfile).not.toHaveBeenCalled();
    });

    it.each([
      'http://cdn.example.com/a.png',
      'javascript:alert(1)',
      'https://user:pw@cdn.example.com/a.png',
      'not a url',
    ])('rejects the avatar URL %s', async (avatarUrl) => {
      await expect(
        service.createVisibilityChallenge(wallet, {
          isPublic: true,
          displayName: 'Alpha',
          slug: 'alpha',
          avatarUrl,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a bio that is too long', async () => {
      await expect(
        service.createVisibilityChallenge(wallet, {
          isPublic: true,
          displayName: 'Alpha',
          slug: 'alpha',
          bio: 'x'.repeat(281),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a slug owned by another wallet', async () => {
      socialRepository.findBySlug.mockResolvedValue(profileA);

      await expect(
        service.createVisibilityChallenge(wallet, {
          isPublic: true,
          displayName: 'Alpha',
          slug: 'alpha',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('never returns a stored non-https avatar to clients', async () => {
    socialRepository.listPublicProfiles.mockResolvedValue([
      { ...profileA, avatarUrl: 'javascript:alert(1)' },
    ]);
    portfolioRepository.listSnapshots.mockResolvedValue([
      snapshot('wallet-a', 150, now),
    ]);

    const leaderboard = await service.getLeaderboard({ timeframe: '30D' });

    expect(leaderboard.rows[0].avatarUrl).toBeUndefined();
  });
});

function profileRow(walletAddress: string, slug: string, displayName: string) {
  return {
    id: `${slug}-id`,
    walletAddress,
    slug,
    displayName,
    avatarUrl: null,
    bio: null,
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function snapshot(
  walletAddress: string,
  totalValueUsd: number,
  timestampMs: number,
  availableValueUsd = totalValueUsd,
  positionsJson?: unknown[],
) {
  return {
    id: `${walletAddress}-${timestampMs}`,
    walletAddress,
    timestamp: new Date(timestampMs),
    totalValueUsd: String(totalValueUsd),
    availableValueUsd: String(availableValueUsd),
    lockedValueUsd: '0',
    positionsJson: positionsJson ?? [
      {
        assetId: 'nvda',
        ticker: 'NVDA',
        name: 'Nvidia',
        allocationPercent: 100,
        valueUsd: availableValueUsd,
      },
    ],
  };
}

function position(assetId: string, ticker: string, valueUsd: number, allocationPercent: number) {
  return {
    assetId,
    ticker,
    name: ticker,
    currentPrice: valueUsd || 0,
    changePercent: 0,
    quantity: 1,
    valueUsd,
    allocationPercent,
    availableAmount: 1,
    lockedAmount: 0,
    availableValueUsd: valueUsd,
    lockedValueUsd: 0,
    variants: [
      {
        variant: {
          mint: `${assetId}-mint`,
          symbol: ticker,
          name: ticker,
          tradable: true,
        },
        availableAmount: 1,
        lockedAmount: 0,
        totalAmount: 1,
      },
    ],
  };
}
