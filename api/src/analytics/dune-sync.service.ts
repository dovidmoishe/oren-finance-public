import { backgroundWorkersEnabled } from '../config/deployment';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { VolumeRepository } from './volume.repository';

const FILLS_TABLE = 'oren_verified_fill_signatures';
const MINTS_TABLE = 'oren_stock_mints';

@Injectable()
export class DuneSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuneSyncService.name);
  private readonly enabled: boolean;
  private timer?: NodeJS.Timeout;
  private tablesReady = false;
  private running = false;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly repository: VolumeRepository,
  ) {
    this.enabled = Boolean(env.DUNE_API_KEY && env.DUNE_UPLOAD_NAMESPACE);
  }

  onModuleInit() {
    if (!backgroundWorkersEnabled()) return;
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), 5 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.tick(), 10_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (!backgroundWorkersEnabled()) return;
    if (!this.enabled || this.running) return;
    this.running = true;
    let jobs = [] as Awaited<ReturnType<VolumeRepository['claimDuneJobs']>>;
    try {
      if (!this.tablesReady) {
        await this.ensureTables();
        this.tablesReady = true;
      }
      jobs = await this.repository.claimDuneJobs();
      if (!jobs.length) return;
      const signatures = jobs.flatMap((job) => job.transactionSignature ? [job.transactionSignature] : []);
      const fills = await this.repository.publicFills(signatures);
      if (fills.length) {
        await Promise.all([
          this.insert(FILLS_TABLE, fills.map((fill) => ({
            transaction_signature: fill.transactionSignature,
            fill_index: fill.fillIndex,
            asset_id: fill.assetId,
            ticker: fill.ticker,
            token_mint: fill.tokenMint,
            side: fill.side,
            stock_amount: Number(fill.stockAmount),
            usd_notional: Number(fill.usdNotional),
            feature_source: fill.featureSource,
            slot: Number(fill.slot),
            block_time: fill.blockTime.toISOString(),
          }))),
          this.insert(MINTS_TABLE, [...new Map(fills.map((fill) => [fill.tokenMint, {
            asset_id: fill.assetId,
            ticker: fill.ticker,
            token_mint: fill.tokenMint,
          }])).values()]),
        ]);
      }
      await this.repository.completeJobs(jobs.map((job) => job.id));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Dune verification sync failed: ${detail}`);
      if (jobs.length) await this.repository.retryJobs(jobs, detail);
    } finally {
      this.running = false;
    }
  }

  private async ensureTables() {
    await this.createTable(FILLS_TABLE, [
      column('transaction_signature', 'varchar'), column('fill_index', 'integer'),
      column('asset_id', 'varchar'), column('ticker', 'varchar'), column('token_mint', 'varchar'),
      column('side', 'varchar'), column('stock_amount', 'double'), column('usd_notional', 'double'),
      column('feature_source', 'varchar'), column('slot', 'double'), column('block_time', 'timestamp'),
    ]);
    await this.createTable(MINTS_TABLE, [
      column('asset_id', 'varchar'), column('ticker', 'varchar'), column('token_mint', 'varchar'),
    ]);
  }

  private async createTable(tableName: string, schema: Array<{ name: string; type: string; nullable: boolean }>) {
    const response = await fetch(`${this.env.DUNE_API_BASE_URL}/uploads`, {
      method: 'POST',
      headers: this.headers('application/json'),
      body: JSON.stringify({
        namespace: this.env.DUNE_UPLOAD_NAMESPACE,
        table_name: tableName,
        description: 'Public Oren platform-volume verification data. Contains no wallet addresses.',
        is_private: false,
        schema,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return;
    const detail = await response.text();
    if (response.status === 400 && /exist/i.test(detail)) return;
    throw new Error(`Dune table ${tableName}: HTTP ${response.status} ${detail.slice(0, 300)}`);
  }

  private async insert(tableName: string, rows: Array<Record<string, unknown>>) {
    if (!rows.length) return;
    const body = rows.map((row) => JSON.stringify(row)).join('\n');
    const namespace = encodeURIComponent(this.env.DUNE_UPLOAD_NAMESPACE!);
    const response = await fetch(`${this.env.DUNE_API_BASE_URL}/uploads/${namespace}/${tableName}/insert`, {
      method: 'POST',
      headers: this.headers('application/x-ndjson'),
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Dune insert ${tableName}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }

  private headers(contentType: string) {
    return { 'X-DUNE-API-KEY': this.env.DUNE_API_KEY!, 'Content-Type': contentType };
  }
}

function column(name: string, type: string) {
  return { name, type, nullable: false };
}
