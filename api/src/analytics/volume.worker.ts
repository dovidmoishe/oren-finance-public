import { backgroundWorkersEnabled } from '../config/deployment';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { USDC_MINT } from '../config/constants';
import { AlchemyService } from '../alchemy/alchemy.service';
import type { AlchemyParsedTokenBalance } from '../alchemy/alchemy.types';
import type { AlchemyParsedTransaction } from '../alchemy/alchemy.types';
import { PortfolioService } from '../portfolio/portfolio.service';
import type { ExecutionFeature } from '../../types/execution';
import type { VerifiedTradeFill } from '../../types/volume';
import { VolumeRepository, type ExecutionJobRow } from './volume.repository';

@Injectable()
export class VolumeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VolumeWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: VolumeRepository,
    private readonly alchemy: AlchemyService,
    private readonly portfolio: PortfolioService,
  ) {}

  onModuleInit() {
    if (!backgroundWorkersEnabled()) return;
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (!backgroundWorkersEnabled()) return;
    if (this.running) return;
    this.running = true;
    try {
      const jobs = await this.repository.claimJobs();
      await Promise.all(jobs.map((job) => this.process(job)));
    } catch (error) {
      this.logger.error(`Volume worker tick failed: ${message(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async process(job: ExecutionJobRow): Promise<void> {
    try {
      if (!job.executionId || !job.transactionSignature) {
        throw new Error('Volume job is missing execution or signature');
      }
      const execution = await this.repository.findExecution(job.executionId);
      if (!execution?.assetId || !execution.ticker || !execution.tokenMint) {
        throw new Error('Execution is missing canonical stock metadata');
      }
      const tx = await this.alchemy.getParsedTransaction(job.transactionSignature);
      if (!tx) throw new Error('Finalized transaction is not available yet');
      if (tx.meta?.err) {
        await this.repository.completeFailedTransaction(job);
        return;
      }
      const fill = buildVerifiedFill(
        {
          ...execution,
          assetId: execution.assetId,
          ticker: execution.ticker,
          tokenMint: execution.tokenMint,
        },
        job.transactionSignature,
        tx,
        // Swaps are signed and paid by the user; limit fills by Jupiter's keeper.
        { requireWalletFeePayer: job.kind === 'swap_fill' },
      );
      await this.repository.completeFill(job.id, fill);
      void this.portfolio.getPortfolio(execution.walletAddress).catch((error) => {
        this.logger.warn(`Post-fill portfolio refresh failed: ${message(error)}`);
      });
    } catch (error) {
      await this.repository.retry(job, message(error));
    }
  }
}

export function buildVerifiedFill(
  execution: {
    id: string;
    walletAddress: string;
    type: string;
    assetId: string;
    ticker: string;
    tokenMint: string;
    featureSource: string;
    provider: string | null;
    createdAt?: Date;
  },
  transactionSignature: string,
  tx: AlchemyParsedTransaction,
  options: { requireWalletFeePayer?: boolean } = {},
): VerifiedTradeFill {
  if (!tx.slot || !tx.blockTime) throw new Error('Transaction has no finalized slot or block time');
  if (options.requireWalletFeePayer) {
    const payer = tx.transaction?.message?.accountKeys?.[0];
    const payerKey = typeof payer === 'string' ? payer : payer?.pubkey;
    if (payerKey !== execution.walletAddress) {
      throw new Error('Transaction fee payer is not the execution wallet');
    }
  }
  // A trade that landed before Oren prepared this execution cannot belong to it.
  // Allow a minute of clock skew between the API host and block time.
  if (
    execution.createdAt &&
    tx.blockTime * 1_000 < execution.createdAt.getTime() - 60_000
  ) {
    throw new Error('Transaction predates the execution it was reported for');
  }
  const stockDelta = tokenDelta(
    tx.meta?.preTokenBalances,
    tx.meta?.postTokenBalances,
    execution.walletAddress,
    execution.tokenMint,
  );
  const usdcDelta = tokenDelta(
    tx.meta?.preTokenBalances,
    tx.meta?.postTokenBalances,
    execution.walletAddress,
    USDC_MINT,
  );
  const side = execution.type === 'stock_purchase' || execution.type === 'limit_buy' ? 'buy' :
    execution.type === 'stock_sale' || execution.type === 'limit_sell' ? 'sell' : null;
  if (!side) throw new Error(`Execution type ${execution.type} is not stock volume`);
  if (side === 'buy' ? stockDelta <= 0 || usdcDelta >= 0 : stockDelta >= 0 || usdcDelta <= 0) {
    throw new Error('On-chain token deltas do not match the recorded trade side');
  }
  const stockAmount = Math.abs(stockDelta);
  const usdNotional = Math.abs(usdcDelta);
  if (!Number.isFinite(stockAmount) || !Number.isFinite(usdNotional) || stockAmount <= 0 || usdNotional <= 0) {
    throw new Error('Verified fill has no positive stock/USDC notional');
  }
  return {
    executionId: execution.id,
    transactionSignature,
    fillIndex: 0,
    walletAddress: execution.walletAddress,
    assetId: execution.assetId,
    ticker: execution.ticker,
    tokenMint: execution.tokenMint,
    side,
    stockAmount,
    usdNotional,
    executionPriceUsd: usdNotional / stockAmount,
    featureSource: execution.featureSource as ExecutionFeature,
    provider: execution.provider ?? 'jupiter',
    slot: tx.slot,
    blockTime: new Date(tx.blockTime * 1_000),
  };
}

export function tokenDelta(
  pre: AlchemyParsedTokenBalance[] | undefined,
  post: AlchemyParsedTokenBalance[] | undefined,
  owner: string,
  mint: string,
): number {
  return sum(post, owner, mint) - sum(pre, owner, mint);
}

function sum(balances: AlchemyParsedTokenBalance[] | undefined, owner: string, mint: string): number {
  return (balances ?? []).reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    const token = balance.uiTokenAmount;
    const value = token?.uiAmountString !== undefined
      ? Number(token.uiAmountString)
      : token?.uiAmount ?? Number(token?.amount ?? 0) / 10 ** (token?.decimals ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
