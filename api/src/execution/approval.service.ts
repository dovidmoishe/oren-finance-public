import { assertFinancialExecutionEnabled } from '../config/deployment';
import { WithdrawalStocksService } from './withdrawal-stocks.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  PreparedLimitCancel,
  PreparedLimitOrder,
  LimitOrderProposal,
} from '../../types/limit-order';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { ApprovalRepository, type ApprovalRow } from './approval.repository';
import { ApprovalRpc } from './approval-rpc.service';
import { ExecutionService } from './execution.service';
import { ExecutionRepository } from './execution.repository';
import { LimitOrderRepository } from './limit-order.repository';
import { LimitOrderCache } from './limit-order-cache';
import { QuoteCache } from './quote-cache';
import { publicQuote, type SwapExpectation } from './swap-terms';

export type ApprovalKind = 'swap' | 'limit' | 'cancel';
@Injectable()
export class ApprovalService {
  constructor(
    private readonly auth: PrivyWalletAuth,
    private readonly approvals: ApprovalRepository,
    private readonly rpc: ApprovalRpc,
    private readonly execution: ExecutionService,
    private readonly executions: ExecutionRepository,
    private readonly orders: LimitOrderRepository,
    private readonly quotes: QuoteCache,
    private readonly limits: LimitOrderCache,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly withdrawalStocks: WithdrawalStocksService,
  ) {}

  async prepare(
    authorization: string | undefined,
    input: { kind: ApprovalKind; referenceId: string; wallet: string },
  ) {
    assertFinancialExecutionEnabled();
    if (this.env.SOLANA_NETWORK !== 'mainnet')
      throw new ServiceUnavailableException(
        'Server trading is only available on Solana mainnet',
      );
    const owner = await this.auth.requireSigner(authorization, input.wallet);
    let prepared: {
      transaction: string;
      executionId: string;
      expiresAt: Date | string;
    };
    let details: Record<string, unknown>;
    let expiresAt = Date.now() + 60_000;
    let expectation: SwapExpectation | undefined;
    if (input.kind === 'swap') {
      // Bind the approval to the quote and bytes prepare actually produced
      // (a refreshed Titan route or the Jupiter fallback), never to a later
      // cache read that a concurrent prepare could have replaced.
      const result = await this.execution.prepareWithQuote({
        quoteId: input.referenceId,
        wallet: input.wallet,
      });
      prepared = result.prepared;
      expectation = result.expectation;
      details = {
        quote: publicQuote(result.quote),
        expectation,
        expiresAfterSlot: result.prepared.expiresAfterSlot,
      };
      expiresAt = Math.min(expiresAt, result.quote.expiresAt.getTime());
    } else if (input.kind === 'limit') {
      const proposal = this.limits.getProposal(input.referenceId);
      prepared = await this.execution.prepareLimitOrder({
        proposalId: proposal.id,
        wallet: input.wallet,
      });
      if (!(prepared as PreparedLimitOrder).orderKey)
        throw new BadRequestException('Limit order address is missing');
      details = {
        proposal,
        orderKey: (prepared as PreparedLimitOrder).orderKey,
      };
    } else {
      const order = await this.orders.findByOrderKey(input.referenceId);
      if (!order || order.walletAddress !== input.wallet)
        throw new ForbiddenException(
          'This limit order does not belong to your wallet',
        );
      prepared = await this.execution.prepareCancelLimitOrder({
        orderKey: input.referenceId,
        wallet: input.wallet,
      });
      details = {
        orderKey: (prepared as PreparedLimitCancel).orderKey,
        ticker: order.ticker,
      };
    }
    const feeLamports = await this.rpc.inspect(
      prepared.transaction,
      input.wallet,
      expectation,
    );
    // The latest blockhash after simulation gives a conservative validity bound
    // for the reviewed transaction without changing its message or blockhash.
    details.blockhashExpiryHeight = await this.rpc.expiryHeight();
    expiresAt = Math.min(expiresAt, new Date(prepared.expiresAt).getTime());
    if (expiresAt <= Date.now())
      throw new BadRequestException('Trade expired. Request a fresh quote.');
    const row = await this.approvals.create({
      userId: owner.userId,
      walletId: owner.walletId,
      wallet: input.wallet,
      kind: input.kind,
      referenceId: input.referenceId,
      executionId: prepared.executionId,
      transaction: prepared.transaction,
      feeLamports,
      expiresAt: new Date(expiresAt),
      details,
    });
    return this.view(row);
  }

  async pending(authorization: string | undefined, wallet: string) {
    const userId = await this.auth.requireWallet(authorization, wallet);
    return (await this.approvals.pending(userId, wallet)).map((row) =>
      this.view(row),
    );
  }

  private async owned(
    authorization: string | undefined,
    id: string,
    signing = true,
  ) {
    const row = await this.approvals.get(id);
    if (!row) throw new NotFoundException('Approval not found');
    if (signing) {
      const owner = await this.auth.requireSigner(authorization, row.wallet);
      if (owner.userId !== row.userId || owner.walletId !== row.walletId)
        throw new ForbiddenException(
          'Approval does not belong to this account',
        );
    } else if (
      (await this.auth.requireWallet(authorization, row.wallet)) !== row.userId
    ) {
      throw new ForbiddenException('Approval does not belong to this account');
    }
    return { row };
  }

  async authorizationRequest(authorization: string | undefined, id: string) {
    assertFinancialExecutionEnabled();
    const { row } = await this.owned(authorization, id);
    if (row.status !== 'prepared' || row.expiresAt.getTime() <= Date.now())
      throw new BadRequestException(
        'Approval expired or already processed. Review a fresh quote.',
      );
    return this.auth.signingRequest(
      row.walletId,
      row.transaction,
      row.id,
      row.expiresAt,
    );
  }

  async approve(
    authorization: string | undefined,
    id: string,
    authorizationSignature?: string,
  ) {
    assertFinancialExecutionEnabled();
    const owned = await this.owned(authorization, id);
    let row = owned.row;
    if (row.status === 'submitted') {
      await this.track(row);
      return this.view(row);
    }
    if (row.status === 'confirmed') return this.view(row);
    if (row.status === 'signing')
      throw new ConflictException(
        'Your approval is being processed. Check its status before retrying.',
      );
    if (row.status === 'failed')
      throw new BadRequestException(
        'This approval cannot be used again. Request a fresh quote.',
      );
    if (row.status === 'prepared') {
      if (!authorizationSignature)
        throw new BadRequestException(
          'Authorize this trade in Oren before confirming.',
        );
      if (row.expiresAt.getTime() <= Date.now())
        throw new BadRequestException(
          'Approval expired. Review a fresh quote.',
        );
      // Simulate again immediately before signing, without changing the
      // reviewed bytes, and re-check balances against the reviewed terms.
      if (row.kind === 'swap') await this.assertSlotValid(row);
      await this.rpc.inspect(
        row.transaction,
        row.wallet,
        row.kind === 'swap'
          ? (row.details.expectation as SwapExpectation | undefined)
          : undefined,
      );
      if (row.expiresAt.getTime() <= Date.now())
        throw new BadRequestException(
          'Approval expired. Review a fresh quote.',
        );
      if (row.kind === 'withdrawal')
        await this.withdrawalStocks.assertReviewed(row.details);
      const claimed = await this.approvals.claim(row.id);
      if (!claimed)
        throw new ConflictException(
          'An approval is already being processed for your wallet.',
        );
      row = claimed;
      try {
        const signed = await this.auth.signTransaction(
          row.walletId,
          authorizationSignature,
          row.transaction,
          row.id,
          row.expiresAt,
        );
        if (row.expiresAt.getTime() <= Date.now())
          throw new BadRequestException(
            'Approval expired before signing completed. No transaction was submitted.',
          );
        const signature = this.rpc.validateSigned(
          row.transaction,
          signed,
          row.wallet,
        );
        // Persist signed bytes before the first network submission; retry only these bytes.
        const persisted = await this.approvals.patch(
          row.id,
          {
            status: 'signed',
            signedTransaction: signed,
            signature,
          },
          'signing',
        );
        if (!persisted)
          throw new BadRequestException(
            'Approval expired before submission. Review the trade again.',
          );
        row = persisted;
      } catch (error) {
        await this.approvals.patch(row.id, { status: 'failed' }, 'signing');
        throw error;
      }
    }
    if (!row.signedTransaction || !row.signature)
      throw new ConflictException('Approval is still being processed.');
    try {
      const signature = await this.rpc.broadcast(row.signedTransaction);
      if (signature !== row.signature)
        throw new Error('RPC signature mismatch');
      row =
        (await this.approvals.patch(
          row.id,
          { status: 'submitted' },
          'signed',
        )) ??
        (await this.approvals.get(row.id)) ??
        row;
      await this.track(row);
    } catch {
      // A network timeout does not prove rejection. Keep signed bytes for an identical retry.
      return {
        ...this.view(row),
        message:
          'Submission is pending. Check status or retry this same approval; do not create another trade.',
      };
    }
    return this.view(row);
  }

  async status(authorization: string | undefined, id: string) {
    assertFinancialExecutionEnabled();
    let { row } = await this.owned(authorization, id, false);
    if (
      row.kind === 'withdrawal' &&
      row.status === 'prepared' &&
      row.expiresAt.getTime() <= Date.now()
    )
      row =
        (await this.approvals.patch(
          row.id,
          { status: 'failed' },
          'prepared',
        )) ??
        (await this.approvals.get(row.id)) ??
        row;
    if (row.status === 'signing' && row.expiresAt.getTime() <= Date.now())
      row =
        (await this.approvals.patch(row.id, { status: 'failed' }, 'signing')) ??
        (await this.approvals.get(row.id)) ??
        row;
    if (
      row.signature &&
      (row.status === 'signed' || row.status === 'submitted')
    ) {
      const status = await this.rpc.status(row.signature);
      if (status?.err)
        row = await this.approvals.patch(row.id, { status: 'failed' });
      else if (
        !status &&
        !(await this.rpc.blockhashValid(
          row.transaction,
          row.wallet,
          Number(row.details.blockhashExpiryHeight),
        ))
      )
        row = await this.approvals.patch(row.id, { status: 'failed' });
      else if (
        status &&
        ['confirmed', 'finalized'].includes(status.confirmationStatus ?? '')
      ) {
        await this.track(row);
        if (row.kind === 'limit') {
          const p = row.details.proposal as LimitOrderProposal;
          await this.orders.upsert({
            walletAddress: row.wallet,
            orderKey: String(row.details.orderKey),
            side: p.side,
            assetId: p.assetId,
            ticker: p.ticker,
            inputMint: p.inputMint,
            outputMint: p.outputMint,
            makingAmount: p.makingAmount,
            takingAmount: p.takingAmount,
            limitPriceUsd: p.limitPriceUsd,
            amountUsd: p.amountUsd,
            status: 'open',
            basis: p.basis,
            openSignature: row.signature,
            expiredAt: new Date(p.expiredAt * 1000),
          });
        } else if (row.kind === 'cancel') {
          await this.orders.updateStatus(
            String(row.details.orderKey),
            {
              status: 'cancelled',
              closeSignature: row.signature,
            },
            row.wallet,
          );
        }
        if (row.kind !== 'swap' && row.kind !== 'withdrawal')
          await this.executions.updateStatus(row.executionId, {
            status: 'confirmed',
            transactionSignature: row.signature,
          });
        row = await this.approvals.patch(row.id, { status: 'confirmed' });
      }
    }
    return this.view(row);
  }

  /** Titan routes carry a slot after which their on-chain state is stale. */
  private async assertSlotValid(row: ApprovalRow) {
    const expiresAfterSlot = Number(row.details.expiresAfterSlot);
    if (!Number.isSafeInteger(expiresAfterSlot) || expiresAfterSlot <= 0)
      return;
    if ((await this.rpc.currentSlot()) > expiresAfterSlot)
      throw new BadRequestException('Approval expired. Review a fresh quote.');
  }

  private async track(row: ApprovalRow) {
    // Withdrawals are transfers, not stock executions; onchain portfolio activity records them.
    if (row.kind === 'withdrawal') return;
    if (!row.signature) return;
    const execution = await this.executions.findById(row.executionId);
    if (execution?.status === 'confirmed' || execution?.status === 'failed')
      return;
    if (row.kind === 'swap')
      await this.executions.submitAndEnqueue({
        executionId: row.executionId,
        walletAddress: row.wallet,
        transactionSignature: row.signature,
      });
    else
      await this.executions.updateStatus(row.executionId, {
        status: 'submitted',
        transactionSignature: row.signature,
      });
  }
  private view(row: ApprovalRow) {
    return {
      id: row.id,
      kind: row.kind,
      referenceId: row.referenceId,
      wallet: row.wallet,
      executionId: row.executionId,
      status: row.status,
      signature: row.signature ?? undefined,
      details: row.details,
      feeLamports: row.feeLamports,
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
