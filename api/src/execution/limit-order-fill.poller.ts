import { backgroundWorkersEnabled } from '../config/deployment';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { VolumeRepository } from '../analytics/volume.repository';
import { ExecutionRepository } from './execution.repository';
import { JupiterTriggerClient } from './jupiter/jupiter-trigger.client';
import type { JupiterTriggerOrderRaw } from './jupiter/jupiter-trigger.types';
import { LimitOrderRepository } from './limit-order.repository';

@Injectable()
export class LimitOrderFillPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LimitOrderFillPoller.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orders: LimitOrderRepository,
    private readonly executions: ExecutionRepository,
    private readonly trigger: JupiterTriggerClient,
    private readonly volume: VolumeRepository,
  ) {}

  onModuleInit() {
    if (!backgroundWorkersEnabled()) return;
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (!backgroundWorkersEnabled()) return;
    if (this.running) return;
    this.running = true;
    try {
      const open = await this.orders.listAllOpen();
      const wallets = [...new Set(open.map((order) => order.walletAddress))];
      for (const wallet of wallets) {
        const history = await this.trigger.getTriggerOrders({
          user: wallet,
          orderStatus: 'history',
          // Never compete with user quotes/swaps for the shared Jupiter budget.
          lane: 'background',
        });
        for (const remote of history.orders ?? []) {
          const local = open.find(
            (order) => order.orderKey === remote.orderKey,
          );
          if (!local?.openSignature) continue;
          const execution = await this.executions.findBySignature(
            local.openSignature,
          );
          if (!execution) continue;
          const signatures = fillSignatures(remote);
          for (const signature of signatures) {
            await this.volume.enqueueLimitFill({
              executionId: execution.id,
              orderKey: local.orderKey,
              transactionSignature: signature,
            });
          }
          const status = remote.status.toLowerCase();
          if (status.includes('filled')) {
            await this.orders.updateStatus(
              local.orderKey,
              { status: 'filled', closeSignature: remote.closeTx ?? undefined },
              local.walletAddress,
            );
          } else if (status.includes('cancel')) {
            await this.orders.updateStatus(
              local.orderKey,
              {
                status: 'cancelled',
                closeSignature: remote.closeTx ?? undefined,
              },
              local.walletAddress,
            );
          } else if (status.includes('expire')) {
            await this.orders.updateStatus(
              local.orderKey,
              {
                status: 'expired',
                closeSignature: remote.closeTx ?? undefined,
              },
              local.walletAddress,
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Limit fill poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}

export function fillSignatures(order: JupiterTriggerOrderRaw): string[] {
  const found = new Set<string>();
  for (const trade of order.trades ?? []) {
    if (!trade || typeof trade !== 'object') continue;
    const row = trade as Record<string, unknown>;
    for (const key of ['signature', 'transactionSignature', 'txId', 'tx']) {
      const value = row[key];
      if (typeof value === 'string' && value.length >= 32) found.add(value);
    }
  }
  if (
    !found.size &&
    order.status.toLowerCase().includes('filled') &&
    order.closeTx
  ) {
    found.add(order.closeTx);
  }
  return [...found];
}
