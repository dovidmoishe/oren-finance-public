import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createPublicKey, verify } from 'crypto';
import bs58 from 'bs58';
import type { Basket, BasketAllocation } from '../../types/execution';
import type { Portfolio } from '../../types/portfolio';
import type {
  CopyPortfolioProposal,
  LeaderboardResponse,
  LeaderboardRow,
  SocialHoldingSummary,
  SocialRiskLabel,
  SocialTimeframe,
  TraderDetailResponse,
  TraderProfile,
  TraderPublicProfile,
  TraderVisibilityChallengeRequest,
  TraderVisibilityChallengeResponse,
  UpdateTraderVisibilityRequest,
  UpdateTraderVisibilityResponse,
} from '../../types/social';
import { MIN_BASKET_LEG_USD } from '../config/constants';
import { ExecutionService } from '../execution/execution.service';
import { equityValueFromSnapshot } from '../portfolio/portfolio.mapper';
import { PortfolioRepository, type SnapshotRow } from '../portfolio/portfolio.repository';
import { PortfolioService } from '../portfolio/portfolio.service';
import {
  normalizeAvatarUrl,
  normalizeBio,
  ProfileChallenges,
  safeStoredAvatarUrl,
} from './profile-challenge';
import { SocialRepository, type TraderProfileRow } from './social.repository';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

@Injectable()
export class SocialService {
  constructor(
    private readonly socialRepository: SocialRepository,
    private readonly portfolioRepository: PortfolioRepository,
    private readonly portfolio: PortfolioService,
    private readonly execution: ExecutionService,
    private readonly challenges: ProfileChallenges = new ProfileChallenges(),
  ) {}

  async getLeaderboard(input?: {
    timeframe?: SocialTimeframe;
    limit?: number;
  }): Promise<LeaderboardResponse> {
    const timeframe = normalizeTimeframe(input?.timeframe);
    const limit = clampInt(input?.limit ?? 50, 1, 100);
    const profiles = await this.socialRepository.listPublicProfiles();
    const rows = await this.buildLeaderboardRows(profiles, timeframe);
    const ranked = rows.slice(0, limit).map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

    return {
      timeframe,
      rows: ranked,
      stats: {
        totalPublicTraders: profiles.length,
        averagePnlPct: average(ranked.map((row) => row.pnlPct)),
        topPerformer: ranked[0],
      },
    };
  }

  async getTraderDetail(
    slug: string,
    timeframe?: SocialTimeframe,
  ): Promise<TraderDetailResponse> {
    const profile = await this.getPublicProfile(slug);
    const normalizedTimeframe = normalizeTimeframe(timeframe);
    const snapshots = await this.portfolioRepository.listSnapshots(
      profile.walletAddress,
      500,
    );
    const stats = buildLeaderboardRow(profile, snapshots, normalizedTimeframe);

    if (!stats) {
      throw new NotFoundException('Public trader profile has no portfolio history yet');
    }
    stats.rank = await this.getRank(profile.slug, normalizedTimeframe);

    const history = historyFromSnapshots(profile.walletAddress, snapshots);
    const latest = [...snapshots].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    )[0];
    const portfolio = portfolioFromSnapshot(profile.walletAddress, latest, stats);
    const activity = await this.portfolio
      .getActivity(profile.walletAddress)
      .catch(() => ({ walletAddress: profile.walletAddress, items: [] }));

    return {
      profile: toPublicProfile(profile),
      stats,
      portfolio,
      history,
      activity,
      timeframe: normalizedTimeframe,
    };
  }

  /**
   * Issues a single-use challenge covering every field the update will write.
   * The wallet signs the returned message; `updateVisibility` then writes the
   * stored terms, never values supplied alongside the signature.
   */
  async createVisibilityChallenge(
    walletAddress: string,
    input: TraderVisibilityChallengeRequest,
  ): Promise<TraderVisibilityChallengeResponse> {
    const existing = await this.socialRepository.findByWallet(walletAddress);
    const displayName = normalizeDisplayName(
      input.displayName ??
        existing?.displayName ??
        walletPreview(walletAddress),
    );
    const slug = normalizeSlug(
      input.slug ?? existing?.slug ?? displayName,
      walletAddress,
    );
    await this.assertSlugAvailable(slug, walletAddress);

    const avatarUrl =
      input.avatarUrl !== undefined
        ? normalizeAvatarUrl(input.avatarUrl)
        : safeStoredAvatarUrl(existing?.avatarUrl);
    const bio =
      input.bio !== undefined
        ? normalizeBio(input.bio)
        : existing?.bio?.trim() || undefined;

    return this.challenges.issue({
      walletAddress,
      isPublic: Boolean(input.isPublic),
      slug,
      displayName,
      avatarUrl,
      bio,
    });
  }

  async updateVisibility(
    walletAddress: string,
    input: UpdateTraderVisibilityRequest,
  ): Promise<UpdateTraderVisibilityResponse> {
    const { nonce, terms } = this.challenges.find(walletAddress, input.message);

    if (!verifyWalletSignature(walletAddress, input.message, input.signature)) {
      throw new BadRequestException('invalid wallet signature');
    }
    if (!this.challenges.consume(nonce)) {
      throw new BadRequestException(
        'Profile update expired or was already used. Review and sign it again.',
      );
    }

    await this.assertSlugAvailable(terms.slug, walletAddress);

    const profile = await this.socialRepository.upsertProfile({
      walletAddress,
      slug: terms.slug,
      displayName: terms.displayName,
      // null, not undefined: the stored row must match exactly what was signed.
      avatarUrl: terms.avatarUrl ?? null,
      bio: terms.bio ?? null,
      isPublic: terms.isPublic,
    });

    return { profile: toTraderProfile(profile) };
  }

  private async assertSlugAvailable(slug: string, walletAddress: string) {
    const slugOwner = await this.socialRepository.findBySlug(slug);
    if (slugOwner && slugOwner.walletAddress !== walletAddress) {
      throw new ConflictException('trader slug is already taken');
    }
  }

  async prepareCopyPortfolio(input: {
    sourceSlug: string;
    wallet: string;
    amountUsd: number;
  }): Promise<CopyPortfolioProposal> {
    const amountUsd = Number(input.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < MIN_BASKET_LEG_USD) {
      throw new BadRequestException(
        `amountUsd must be at least ${MIN_BASKET_LEG_USD}`,
      );
    }
    const profile = await this.getPublicProfile(input.sourceSlug);
    const snapshots = await this.portfolioRepository.listSnapshots(
      profile.walletAddress,
      50,
    );
    const stats = buildLeaderboardRow(profile, snapshots, '30D');
    if (!stats) {
      throw new BadRequestException('No observed portfolio history is available to copy');
    }
    const latest = [...snapshots].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    )[0];
    const sourcePortfolio = portfolioFromSnapshot(
      profile.walletAddress,
      latest,
      stats,
    );
    const { selected, skippedAssets } = selectCopyPositions(
      sourcePortfolio,
      amountUsd,
    );

    if (selected.length === 0) {
      throw new BadRequestException('No supported holdings are available to copy');
    }

    const allocations = buildCopyAllocations(selected, amountUsd);
    const totalAmountUsd = roundMoney(
      allocations.reduce((sum, allocation) => sum + allocation.amountUsd, 0),
    );
    const source = toPublicProfile(profile);
    const basket = this.execution.createBasketFromAllocations({
      totalAmountUsd,
      allocations,
      thesis: `Copying ${source.displayName}'s observed Oren portfolio weights with ${formatUsd(totalAmountUsd)}.`,
      riskLabel: riskForBasket(sourcePortfolio),
      featureSource: 'copy_trade',
    });

    return {
      source,
      amountUsd: totalAmountUsd,
      allocations,
      skippedAssets,
      riskCopy:
        'Oren creates a proportional basket proposal only. You review the basket and sign each transaction yourself.',
      basket,
    };
  }

  private async getPublicProfile(slug: string): Promise<TraderProfileRow> {
    const normalized = normalizeSlug(slug);
    const profile = await this.socialRepository.findBySlug(normalized);
    if (!profile || !profile.isPublic) {
      throw new NotFoundException('Public trader profile not found');
    }
    return profile;
  }

  private async buildLeaderboardRows(
    profiles: TraderProfileRow[],
    timeframe: SocialTimeframe,
  ): Promise<LeaderboardRow[]> {
    const rows: LeaderboardRow[] = [];
    for (const profile of profiles) {
      const snapshots = await this.portfolioRepository.listSnapshots(
        profile.walletAddress,
        1000,
      );
      const row = buildLeaderboardRow(profile, snapshots, timeframe);
      if (row) rows.push(row);
    }

    return rows
      .sort((a, b) => b.pnlPct - a.pnlPct || b.pnlUsd - a.pnlUsd)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  private async getRank(
    slug: string,
    timeframe: SocialTimeframe,
  ): Promise<number> {
    const profiles = await this.socialRepository.listPublicProfiles();
    const rows = await this.buildLeaderboardRows(profiles, timeframe);
    return rows.find((row) => row.slug === slug)?.rank ?? 0;
  }
}

function buildLeaderboardRow(
  profile: TraderProfileRow,
  snapshots: SnapshotRow[],
  timeframe: SocialTimeframe,
): LeaderboardRow | null {
  if (snapshots.length === 0) return null;
  const chronological = [...snapshots].reverse();
  const latest = chronological[chronological.length - 1];
  const baseline = findBaseline(chronological, timeframe);
  const latestValue = equityValueFromSnapshot(latest);
  const baselineValue = equityValueFromSnapshot(baseline);

  if (!Number.isFinite(latestValue) || !Number.isFinite(baselineValue)) {
    return null;
  }

  const pnlUsd = roundMoney(latestValue - baselineValue);
  const pnlPct =
    baselineValue > 0 ? roundPercent((pnlUsd / baselineValue) * 100) : 0;
  const positions = positionsFromSnapshot(latest);

  return {
    rank: 0,
    slug: profile.slug,
    displayName: profile.displayName,
    walletPreview: walletPreview(profile.walletAddress),
    avatarUrl: safeStoredAvatarUrl(profile.avatarUrl),
    totalValueUsd: roundMoney(latestValue),
    pnlUsd,
    pnlPct,
    positionCount: positions.length,
    topHolding: positions[0],
    riskLabel: riskFromSnapshots(chronological),
    updatedAt: latest.timestamp,
  };
}

function findBaseline(
  chronological: SnapshotRow[],
  timeframe: SocialTimeframe,
): SnapshotRow {
  if (timeframe === 'ALL') return chronological[0];
  const cutoff = new Date(Date.now() - timeframeDays(timeframe) * 86_400_000);
  return (
    chronological.find((snapshot) => snapshot.timestamp >= cutoff) ??
    chronological[0]
  );
}

function positionsFromSnapshot(snapshot: SnapshotRow): SocialHoldingSummary[] {
  const positions = Array.isArray(snapshot.positionsJson)
    ? snapshot.positionsJson
    : [];

  return positions
    .map((item) => {
      const position = item as Record<string, unknown>;
      return {
        assetId: String(position.assetId ?? ''),
        ticker: String(position.ticker ?? ''),
        name: String(position.name ?? position.ticker ?? ''),
        logoUrl:
          typeof position.logo === 'string'
            ? position.logo
            : typeof position.logoUrl === 'string'
              ? position.logoUrl
              : undefined,
        allocationPct: Number(position.allocationPercent ?? 0),
        valueUsd: Number(position.valueUsd ?? 0),
      };
    })
    .filter(
      (position) =>
        position.assetId &&
        position.ticker &&
        Number.isFinite(position.valueUsd) &&
        position.valueUsd > 0,
    )
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

function fullPositionsFromSnapshot(snapshot: SnapshotRow): Portfolio['positions'] {
  const positions = Array.isArray(snapshot.positionsJson)
    ? snapshot.positionsJson
    : [];

  return positions
    .filter((item): item is Portfolio['positions'][number] => {
      const position = item as Record<string, unknown>;
      return Boolean(
        position.assetId &&
          position.ticker &&
          position.name &&
          Number.isFinite(Number(position.valueUsd)),
      );
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

function historyFromSnapshots(
  walletAddress: string,
  snapshots: SnapshotRow[],
): TraderDetailResponse['history'] {
  const points = [...snapshots]
    .reverse()
    .map((row) => ({
      timestamp: row.timestamp,
      totalValueUsd: Number(row.totalValueUsd),
      availableValueUsd: Number(row.availableValueUsd),
      lockedValueUsd: Number(row.lockedValueUsd),
    }));

  return { walletAddress, points };
}

function portfolioFromSnapshot(
  walletAddress: string,
  snapshot: SnapshotRow,
  stats: LeaderboardRow,
): Portfolio {
  return {
    walletAddress,
    totalValueUsd: Number(snapshot.totalValueUsd),
    availableValueUsd: Number(snapshot.availableValueUsd),
    lockedValueUsd: Number(snapshot.lockedValueUsd),
    cashValueUsd: Math.max(
      0,
      Number(snapshot.totalValueUsd) -
        Number(snapshot.availableValueUsd) -
        Number(snapshot.lockedValueUsd),
    ),
    absoluteChangeUsd: stats.pnlUsd,
    percentChange: stats.pnlPct,
    positions: fullPositionsFromSnapshot(snapshot),
    updatedAt: snapshot.timestamp,
  };
}

function selectCopyPositions(portfolio: Portfolio, amountUsd: number) {
  const skippedAssets: CopyPortfolioProposal['skippedAssets'] = [];
  const candidates = portfolio.positions
    .filter((position) => {
      if (position.valueUsd <= 0 || position.currentPrice <= 0) {
        skippedAssets.push({
          assetId: position.assetId,
          ticker: position.ticker,
          reason: 'No current positive valuation',
        });
        return false;
      }
      if (
        position.variants?.length &&
        !position.variants.some((item) => item.variant.tradable)
      ) {
        skippedAssets.push({
          assetId: position.assetId,
          ticker: position.ticker,
          reason: 'No tradable variant available',
        });
        return false;
      }
      return true;
    })
    .sort((a, b) => b.valueUsd - a.valueUsd);

  const maxLegs = Math.min(
    5,
    candidates.length,
    Math.max(1, Math.floor(amountUsd / MIN_BASKET_LEG_USD)),
  );
  const selected = candidates.slice(0, maxLegs);

  for (const position of candidates.slice(maxLegs)) {
    skippedAssets.push({
      assetId: position.assetId,
      ticker: position.ticker,
      reason: 'Outside top copied holdings for v1',
    });
  }

  return { selected, skippedAssets };
}

function buildCopyAllocations(
  positions: Portfolio['positions'],
  amountUsd: number,
): BasketAllocation[] {
  const totalWeight = positions.reduce(
    (sum, position) => sum + Math.max(position.valueUsd, 0),
    0,
  );
  const minCents = MIN_BASKET_LEG_USD * 100;
  const totalCents = Math.round(amountUsd * 100);
  const distributableCents = totalCents - positions.length * minCents;
  let remainingCents = totalCents;

  return positions.map((position, index) => {
    const isLast = index === positions.length - 1;
    const weightedExtra = Math.round(
      (distributableCents * position.valueUsd) / totalWeight,
    );
    const cents = isLast ? remainingCents : minCents + weightedExtra;
    remainingCents -= cents;
    const legAmount = cents / 100;

    return {
      assetId: position.assetId,
      ticker: position.ticker,
      name: position.name,
      amountUsd: roundMoney(legAmount),
      weightPercent: roundPercent((legAmount / amountUsd) * 100),
      rationale: `${position.ticker} mirrors ${formatPercent(position.allocationPercent)} of the source trader's observed portfolio.`,
    };
  });
}

function riskFromSnapshots(snapshots: SnapshotRow[]): SocialRiskLabel {
  if (snapshots.length < 3) return 'new';
  const returns: number[] = [];
  for (let i = 1; i < snapshots.length; i += 1) {
    const previous = equityValueFromSnapshot(snapshots[i - 1]);
    const current = equityValueFromSnapshot(snapshots[i]);
    if (previous > 0 && Number.isFinite(current)) {
      returns.push(((current - previous) / previous) * 100);
    }
  }
  const stdev = standardDeviation(returns);
  if (stdev < 2) return 'steady';
  if (stdev < 6) return 'moderate';
  return 'volatile';
}

function riskForBasket(portfolio: Portfolio): Basket['riskLabel'] {
  const concentration = Math.max(
    ...portfolio.positions.map((position) => position.allocationPercent),
    0,
  );
  if (concentration >= 60) return 'high';
  if (concentration >= 40) return 'elevated';
  return 'moderate';
}

function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string,
): boolean {
  try {
    const publicKeyBytes = bs58.decode(walletAddress);
    const signatureBytes = bs58.decode(signature);
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) {
      return false;
    }
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}

function toTraderProfile(row: TraderProfileRow): TraderProfile {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    slug: row.slug,
    displayName: row.displayName,
    avatarUrl: safeStoredAvatarUrl(row.avatarUrl),
    bio: row.bio ?? undefined,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublicProfile(row: TraderProfileRow): TraderPublicProfile {
  return {
    slug: row.slug,
    displayName: row.displayName,
    walletPreview: walletPreview(row.walletAddress),
    avatarUrl: safeStoredAvatarUrl(row.avatarUrl),
    bio: row.bio ?? undefined,
  };
}

function normalizeTimeframe(value?: string): SocialTimeframe {
  return value === '7D' || value === '90D' || value === 'ALL' ? value : '30D';
}

function timeframeDays(timeframe: SocialTimeframe): number {
  if (timeframe === '7D') return 7;
  if (timeframe === '90D') return 90;
  return 30;
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim().slice(0, 48);
  if (!displayName) throw new BadRequestException('displayName is required');
  return displayName;
}

function normalizeSlug(value: string, fallbackWallet?: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (normalized.length >= 3) return normalized;
  if (fallbackWallet) return `trader-${fallbackWallet.slice(0, 8).toLowerCase()}`;
  throw new BadRequestException('slug is required');
}

function walletPreview(walletAddress: string): string {
  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return roundPercent(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPercent(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatUsd(value: number): string {
  return `$${roundMoney(value).toLocaleString('en-US')}`;
}

function formatPercent(value: number): string {
  return `${roundPercent(value)}%`;
}
