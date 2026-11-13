import { USDC_MINT, USD_ASSET_ID } from '../config/constants';
import type { Equity, TokenizedEquity } from '../../types/equity';
import type { Portfolio } from '../../types/portfolio';
import type { Position, PositionVariant } from '../../types/position';
import type { TokenBalance } from '../../types/providers/alchemy-provider';
import type { TokensMarketSnapshotRaw } from '../tokens/tokens.types';
import type { VaultPositionRow } from './portfolio.repository';

export interface HoldingLot {
  mint: string;
  amount: number;
  equity: Equity;
  price?: number;
  priceChange24h?: number;
}

export function isCashMint(mint: string, assetId?: string): boolean {
  return mint === USDC_MINT || assetId === USD_ASSET_ID;
}

/** Observed stock/equity value from a snapshot; excludes idle USDC cash. */
export function equityValueFromSnapshot(snapshot: {
  availableValueUsd: string | number;
  lockedValueUsd: string | number;
}): number {
  const available = Number(snapshot.availableValueUsd);
  const locked = Number(snapshot.lockedValueUsd);
  if (!Number.isFinite(available) || !Number.isFinite(locked)) return 0;
  return available + locked;
}

export function buildLockedByMint(
  locks: VaultPositionRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const lock of locks) {
    const amount = Number(lock.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    map.set(lock.mint, (map.get(lock.mint) ?? 0) + amount);
  }
  return map;
}

export function priceFromSnapshots(
  snapshots: TokensMarketSnapshotRaw[],
): Map<string, { price?: number; priceChange24h?: number }> {
  const map = new Map<string, { price?: number; priceChange24h?: number }>();
  for (const snap of snapshots) {
    if (!snap.mint) continue;
    map.set(snap.mint, {
      price: snap.price,
      priceChange24h: snap.priceChange24hPercent,
    });
  }
  return map;
}

/**
 * Group resolved equity lots into Positions; apply locked amounts by mint.
 */
export function buildPositions(
  lots: HoldingLot[],
  lockedByMint: Map<string, number>,
): Position[] {
  const byAsset = new Map<
    string,
    {
      equity: Equity;
      availableByMint: Map<string, number>;
      price: number;
      priceChange24h?: number;
    }
  >();

  for (const lot of lots) {
    const existing = byAsset.get(lot.equity.id);
    if (!existing) {
      byAsset.set(lot.equity.id, {
        equity: lot.equity,
        availableByMint: new Map([[lot.mint, lot.amount]]),
        price: lot.price ?? lot.equity.price ?? 0,
        priceChange24h: lot.priceChange24h ?? lot.equity.priceChange24h,
      });
    } else {
      existing.availableByMint.set(
        lot.mint,
        (existing.availableByMint.get(lot.mint) ?? 0) + lot.amount,
      );
      if (lot.price !== undefined && lot.price > 0) {
        existing.price = lot.price;
      }
      if (lot.priceChange24h !== undefined) {
        existing.priceChange24h = lot.priceChange24h;
      }
    }
  }

  const positions: Position[] = [];

  for (const [, group] of byAsset) {
    const variants: PositionVariant[] = [];
    let availableAmount = 0;
    let lockedAmount = 0;

    const mints = new Set([
      ...group.availableByMint.keys(),
      ...[...lockedByMint.keys()].filter((mint) =>
        group.equity.variants.some((v) => v.mint === mint),
      ),
    ]);

    // Include locked mints that belong to this equity even if available is 0
    for (const variant of group.equity.variants) {
      if (lockedByMint.has(variant.mint)) mints.add(variant.mint);
    }

    for (const mint of mints) {
      const available = group.availableByMint.get(mint) ?? 0;
      const locked = lockedByMint.get(mint) ?? 0;
      if (available <= 0 && locked <= 0) continue;

      availableAmount += available;
      lockedAmount += locked;

      const tokenVariant: TokenizedEquity =
        group.equity.variants.find((v) => v.mint === mint) ?? {
          mint,
          symbol: mint.slice(0, 6),
          name: mint,
          tradable: true,
        };

      variants.push({
        variant: tokenVariant,
        availableAmount: available,
        lockedAmount: locked,
        totalAmount: available + locked,
      });
    }

    const quantity = availableAmount + lockedAmount;
    if (quantity <= 0) continue;

    const price = group.price > 0 ? group.price : 0;
    const availableValueUsd = availableAmount * price;
    const lockedValueUsd = lockedAmount * price;
    const valueUsd = availableValueUsd + lockedValueUsd;
    const changePercent = group.priceChange24h ?? 0;

    positions.push({
      assetId: group.equity.id,
      ticker: group.equity.ticker,
      name: group.equity.name,
      logo: group.equity.logo,
      category: group.equity.category,
      currentPrice: price,
      priceChange24h: group.priceChange24h,
      changePercent,
      quantity,
      valueUsd,
      allocationPercent: 0,
      availableAmount,
      lockedAmount,
      availableValueUsd,
      lockedValueUsd,
      variants: variants.length > 0 ? variants : undefined,
    });
  }

  return positions.sort((a, b) => b.valueUsd - a.valueUsd);
}

export function applyAllocations(
  positions: Position[],
  totalValueUsd: number,
): Position[] {
  if (totalValueUsd <= 0) {
    return positions.map((p) => ({ ...p, allocationPercent: 0 }));
  }
  return positions.map((p) => ({
    ...p,
    allocationPercent: (p.valueUsd / totalValueUsd) * 100,
  }));
}

export function buildPortfolio(input: {
  walletAddress: string;
  positions: Position[];
  cashValueUsd: number;
  previousTotalValueUsd?: number | null;
}): Portfolio {
  const availableValueUsd = input.positions.reduce(
    (sum, p) => sum + p.availableValueUsd,
    0,
  );
  const lockedValueUsd = input.positions.reduce(
    (sum, p) => sum + p.lockedValueUsd,
    0,
  );
  const equityValue = availableValueUsd + lockedValueUsd;
  const totalValueUsd = equityValue + input.cashValueUsd;

  const positions = applyAllocations(input.positions, totalValueUsd);

  let absoluteChangeUsd = 0;
  let percentChange = 0;
  if (
    input.previousTotalValueUsd !== undefined &&
    input.previousTotalValueUsd !== null &&
    input.previousTotalValueUsd > 0
  ) {
    absoluteChangeUsd = totalValueUsd - input.previousTotalValueUsd;
    percentChange = (absoluteChangeUsd / input.previousTotalValueUsd) * 100;
  }

  return {
    walletAddress: input.walletAddress,
    totalValueUsd,
    absoluteChangeUsd,
    percentChange,
    availableValueUsd,
    lockedValueUsd,
    cashValueUsd: input.cashValueUsd,
    positions,
    updatedAt: new Date(),
  };
}

/** Sum cash from balances that are USDC before resolve. */
export function cashFromBalances(balances: TokenBalance[]): number {
  return balances
    .filter((b) => b.mint === USDC_MINT && b.uiAmount > 0)
    .reduce((sum, b) => sum + b.uiAmount, 0);
}
