import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Equity } from '../../../types/equity';
import type { CompanyResearchData } from '../../../types/company-research';
import type { ResearchSource } from '../../../types/research';
import { APP_ENV } from '../../config/constants';
import type { AppEnv } from '../../config/env.schema';
import { assembleCompanyResearch } from './assemble';
import {
  openPostgresLock,
  secEdgarAccess,
  SecWorkerSession,
  type SecLockConnection,
} from './sec-access';
import {
  createLiveSecClient,
  SecFetchError,
  type SecCompanySnapshot,
  type SecEdgarClient,
  type SecHttpResponse,
} from './sec-client';

export const SEC_LOCK_OPEN = Symbol('SEC_LOCK_OPEN');
export const SEC_HTTP = Symbol('SEC_HTTP');

@Injectable()
export class CompanyResearchService implements OnModuleDestroy {
  private session?: SecWorkerSession;
  private client?: SecEdgarClient;
  private lost = false;
  private destroyed = false;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Optional()
    @Inject(SEC_LOCK_OPEN)
    private readonly openLock?: () => Promise<SecLockConnection | undefined>,
    @Optional()
    @Inject(SEC_HTTP)
    private readonly http?: (
      url: string,
      init: { signal: AbortSignal; headers: Record<string, string> },
    ) => Promise<SecHttpResponse>,
  ) {}

  load(
    equity: Equity,
    now = new Date(),
  ): Promise<ResearchSource<CompanyResearchData>> {
    return this.gate().then((sec) =>
      assembleCompanyResearch(equity, { sec, now }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    this.lost = true;
    this.client?.halt();
    await this.session?.close();
  }

  private async gate(): Promise<{
    loadCompany(cik: string): Promise<SecCompanySnapshot>;
  }> {
    const access = secEdgarAccess({
      ...this.env,
      NODE_APP_INSTANCE: process.env.NODE_APP_INSTANCE,
      WEB_CONCURRENCY: process.env.WEB_CONCURRENCY,
    });
    if (!access.enabled) return disabledSec(access.reason);
    if (this.destroyed || this.lost) {
      return disabledSec('sec_worker_unavailable');
    }
    if (!this.session) {
      const session = await SecWorkerSession.acquire(() =>
        this.openLock
          ? this.openLock()
          : openPostgresLock(this.env.POSTGRES_URL),
      );
      if (!session || this.destroyed) {
        await session?.close();
        return disabledSec('sec_worker_unavailable');
      }
      this.session = session;
      this.client = createLiveSecClient(
        access.userAgent,
        () => session.admit(),
        this.http,
      );
      session.onLost(() => {
        this.lost = true;
        this.client?.halt();
      });
    }
    if (!(await this.session.admit())) {
      return disabledSec('sec_worker_unavailable');
    }
    return this.client ?? disabledSec('sec_worker_unavailable');
  }
}

function disabledSec(reason: SecFetchError['reason']): {
  loadCompany(cik: string): Promise<SecCompanySnapshot>;
} {
  return {
    loadCompany: () =>
      Promise.reject(new SecFetchError(reason, { retryable: false })),
  };
}
