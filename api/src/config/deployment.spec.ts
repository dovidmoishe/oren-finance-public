import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import {
  deploymentCapabilities,
  assertFinancialExecutionEnabled,
} from './deployment';
import { PreviewGuard } from '../common/preview.guard';
import { ExecutionService } from '../execution/execution.service';
import { ApprovalService } from '../execution/approval.service';
import { VaultService } from '../vault/vault.service';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { VolumeWorker } from '../analytics/volume.worker';
import { LimitOrderFillPoller } from '../execution/limit-order-fill.poller';
import { DuneSyncService } from '../analytics/dune-sync.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import type { ArgumentsHost } from '@nestjs/common';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const preview = {
  DEPLOYMENT_ENV: 'preview',
  PREVIEW_PR_NUMBER: '42',
  COMMIT_SHA: 'a'.repeat(40),
};
describe('preview capabilities', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  it('keeps production behavior and validates preview metadata', () => {
    expect(deploymentCapabilities({ NODE_ENV: 'production' })).toMatchObject({
      financialExecution: true,
      backgroundWorkers: true,
    });
    expect(deploymentCapabilities(preview)).toMatchObject({
      environment: 'preview',
      prNumber: 42,
      financialExecution: false,
      backgroundWorkers: false,
    });
    expect(() => deploymentCapabilities({ DEPLOYMENT_ENV: 'typo' })).toThrow();
    expect(() =>
      deploymentCapabilities({ ...preview, COMMIT_SHA: 'short' }),
    ).toThrow();
    expect(() =>
      deploymentCapabilities({ ...preview, PREVIEW_PR_NUMBER: '0' }),
    ).toThrow();
    expect(() => assertFinancialExecutionEnabled(preview)).toThrow(
      ForbiddenException,
    );
  });
  it('allows research but rejects new write routes and authorization requests', () => {
    Object.assign(process.env, preview);
    const guard = new PreviewGuard();
    const context = (method: string, path: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
      }) as ExecutionContext;
    for (const path of [
      '/api/stocks',
      '/api/portfolio/wallet/funding',
      '/api/environment',
    ])
      expect(guard.canActivate(context('GET', path))).toBe(true);
    expect(
      guard.canActivate(context('POST', '/api/agent/message/stream')),
    ).toBe(true);
    expect(guard.canActivate(context('POST', '/api/feedback'))).toBe(true);
    for (const [method, path] of [
      ['POST', '/api/execution/prepare'],
      ['POST', '/api/future-money-endpoint'],
      ['GET', '/api/execution/approvals/id/authorization'],
    ])
      expect(() => guard.canActivate(context(method, path))).toThrow(
        ForbiddenException,
      );
  });
  it('blocks internal execution calls before accessing any dependencies', async () => {
    Object.assign(process.env, preview);
    // Prototype calls have no providers: a missing gate would touch a provider and fail differently.
    for (const [prototype, names] of [
      [
        ExecutionService.prototype,
        [
          'prepare',
          'prepareWithQuote',
          'confirm',
          'prepareBasketPurchase',
          'prepareLimitOrder',
          'confirmLimitOrder',
          'prepareCancelLimitOrder',
          'confirmCancelLimitOrder',
        ],
      ],
      [
        ApprovalService.prototype,
        ['prepare', 'authorizationRequest', 'approve', 'status'],
      ],
      [
        VaultService.prototype,
        ['prepareLock', 'confirmLock', 'prepareUnlock', 'confirmUnlock'],
      ],
      [PrivyWalletAuth.prototype, ['signTransaction']],
    ] as const)
      for (const name of names) {
        const fn = (
          prototype as unknown as Record<
            string,
            (...args: unknown[]) => Promise<unknown>
          >
        )[name];
        await expect(fn.call({}, undefined)).rejects.toMatchObject({
          response: { code: 'PREVIEW_EXECUTION_DISABLED' },
        });
      }
    await expect(
      AlchemyClient.prototype.call.call({}, 'sendTransaction', []),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not start timers or claim jobs in previews', async () => {
    Object.assign(process.env, preview);
    const timer = jest.spyOn(global, 'setInterval');
    try {
      for (const prototype of [
        VolumeWorker.prototype,
        LimitOrderFillPoller.prototype,
        DuneSyncService.prototype,
      ]) {
        prototype.onModuleInit.call({});
        await prototype.tick.call({});
      }
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });
  it('preserves the preview error code in the real HTTP error formatter', () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/execution/prepare' }),
      }),
    } as unknown as ArgumentsHost;
    try {
      assertFinancialExecutionEnabled(preview);
    } catch (error) {
      new HttpExceptionFilter().catch(error, host);
    }
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PREVIEW_EXECUTION_DISABLED' }),
    );
  });
});
