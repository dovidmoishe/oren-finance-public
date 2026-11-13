import { Injectable, Logger } from '@nestjs/common';
import type { ActivityFeed, ActivityItem, ExecutionRecord } from '../../types/activity';
import type { ExecutionStatus, ExecutionType } from '../../types/execution';
import type {
  Portfolio,
  PortfolioHistory,
} from '../../types/portfolio';
import { AlchemyService } from '../alchemy/alchemy.service';
import { USDC_MINT } from '../config/constants';
import { routeVenueLabel } from '../execution/route-label';
import { TokensService } from '../tokens/tokens.service';
import {
  buildLockedByMint,
  buildPortfolio,
  buildPositions,
  cashFromBalances,
  isCashMint,
  priceFromSnapshots,
  type HoldingLot,
} from './portfolio.mapper';
import {
  PortfolioRepository,
  type ExecutionRow,
} from './portfolio.repository';

const RESOLVE_CONCURRENCY = 6;

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly alchemy: AlchemyService,
    private readonly tokens: TokensService,
    private readonly repository: PortfolioRepository,
  ) {}

  async getPortfolio(walletAddress: string): Promise<Portfolio> {
    const [balances, locks, previous] = await Promise.all([
      this.alchemy.getTokenBalances(walletAddress),
      this.repository.listVaultPositions(walletAddress),
      this.repository.getLatestSnapshot(walletAddress),
    ]);

    let cashValueUsd = cashFromBalances(balances);
    const nonCash = balances.filter(
      (b) => b.uiAmount > 0 && b.mint !== USDC_MINT,
    );

    const resolved = await mapPool(nonCash, RESOLVE_CONCURRENCY, async (bal) => {
      try {
        const equity = await this.tokens.resolveMint(bal.mint);
        if (!equity) return null;
        if (isCashMint(bal.mint, equity.id)) {
          return { kind: 'cash' as const, amount: bal.uiAmount };
        }
        return {
          kind: 'lot' as const,
          lot: {
            mint: bal.mint,
            amount: bal.uiAmount,
            equity,
          } satisfies Omit<HoldingLot, 'price' | 'priceChange24h'>,
        };
      } catch (err) {
        this.logger.warn(
          `resolveMint failed for ${bal.mint}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    });

    const lots: HoldingLot[] = [];
    for (const item of resolved) {
      if (!item) continue;
      if (item.kind === 'cash') {
        cashValueUsd += item.amount;
      } else {
        lots.push(item.lot);
      }
    }

    const equityMints = [...new Set(lots.map((l) => l.mint))];
    let snapshots: Awaited<ReturnType<TokensService['getMarketSnapshots']>> =
      [];
    try {
      if (equityMints.length > 0) {
        snapshots = await this.tokens.getMarketSnapshots(equityMints);
      }
    } catch (err) {
      this.logger.warn(
        `market-snapshots failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const priceMap = priceFromSnapshots(snapshots);
    const pricedLots: HoldingLot[] = lots.map((lot) => {
      const snap = priceMap.get(lot.mint);
      const price =
        snap?.price ??
        lot.equity.price ??
        lot.equity.variants.find((v) => v.mint === lot.mint)?.liquidity;
      return {
        ...lot,
        price: typeof price === 'number' ? price : 0,
        priceChange24h:
          snap?.priceChange24h ?? lot.equity.priceChange24h,
      };
    });

    // Ensure equity.variants includes held mints for mapper
    for (const lot of pricedLots) {
      if (!lot.equity.variants.some((v) => v.mint === lot.mint)) {
        lot.equity = {
          ...lot.equity,
          variants: [
            ...lot.equity.variants,
            {
              mint: lot.mint,
              symbol: lot.equity.ticker,
              name: lot.equity.name,
              tradable: true,
            },
          ],
        };
      }
    }

    const lockedByMint = buildLockedByMint(locks);
    const positions = buildPositions(pricedLots, lockedByMint);

    const previousTotal = previous
      ? Number(previous.totalValueUsd)
      : null;

    const portfolio = buildPortfolio({
      walletAddress,
      positions,
      cashValueUsd,
      previousTotalValueUsd: previousTotal,
    });

    try {
      await this.repository.insertSnapshot({
        walletAddress,
        totalValueUsd: portfolio.totalValueUsd,
        availableValueUsd: portfolio.availableValueUsd,
        lockedValueUsd: portfolio.lockedValueUsd,
        positionsJson: portfolio.positions,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write portfolio snapshot: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return portfolio;
  }

  async getHistory(walletAddress: string): Promise<PortfolioHistory> {
    const rows = await this.repository.listSnapshots(walletAddress);
    // list is newest-first; reverse for chart chronological order
    const points = [...rows].reverse().map((row) => ({
      timestamp: row.timestamp,
      totalValueUsd: Number(row.totalValueUsd),
      availableValueUsd: Number(row.availableValueUsd),
      lockedValueUsd: Number(row.lockedValueUsd),
    }));
    return { walletAddress, points };
  }

  async getActivity(walletAddress: string): Promise<ActivityFeed> {
    const [orenRows, walletTxs] = await Promise.all([
      this.repository.listExecutions(walletAddress, 50),
      this.alchemy
        .getTransactionHistory(walletAddress, { limit: 20 })
        .catch((err) => {
          this.logger.warn(
            `wallet activity failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }),
    ]);

    const orenItems: ActivityItem[] = orenRows.map((row) => ({
      source: 'oren' as const,
      ...mapExecutionRow(row),
    }));

    const walletItems: ActivityItem[] = walletTxs.map((tx) => ({
      source: 'wallet' as const,
      ...tx,
    }));

    const items = [...orenItems, ...walletItems].sort((a, b) => {
      const ta =
        a.source === 'oren'
          ? a.createdAt.getTime()
          : (a.blockTime?.getTime() ?? 0);
      const tb =
        b.source === 'oren'
          ? b.createdAt.getTime()
          : (b.blockTime?.getTime() ?? 0);
      return tb - ta;
    });

    return { walletAddress, items };
  }
}

export function mapExecutionRow(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    type: row.type as ExecutionType,
    assetId: row.assetId ?? undefined,
    ticker: row.ticker ?? undefined,
    tokenMint: row.tokenMint ?? undefined,
    inputAsset: row.inputAsset ?? undefined,
    outputAsset: row.outputAsset ?? undefined,
    amount: row.amount !== null ? Number(row.amount) : undefined,
    amountUsd: row.amountUsd !== null ? Number(row.amountUsd) : undefined,
    provider: row.provider ?? undefined,
    route: routeVenueLabel(row.provider),
    transactionSignature: row.transactionSignature ?? undefined,
    status: row.status as ExecutionStatus,
    createdAt: row.createdAt,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
