import { Injectable } from '@nestjs/common';
import type {
  LimitOrderProposal,
  PreparedLimitCancel,
  PreparedLimitOrder,
} from '../../types/limit-order';
import { BASKET_TTL_MS } from '../config/constants';
import { LimitOrderExpiredError } from '../common/errors/provider.errors';

interface CachedProposal {
  proposal: LimitOrderProposal;
  storedAt: number;
  prepared?: {
    prepared: PreparedLimitOrder;
    expiresAt: number;
  };
}

interface CachedCancel {
  prepared: PreparedLimitCancel;
  expiresAt: number;
}

@Injectable()
export class LimitOrderCache {
  private readonly proposals = new Map<string, CachedProposal>();
  private readonly cancels = new Map<string, CachedCancel>();

  setProposal(proposal: LimitOrderProposal): void {
    this.proposals.set(proposal.id, {
      proposal,
      storedAt: Date.now(),
    });
  }

  getProposal(proposalId: string): LimitOrderProposal {
    const entry = this.proposals.get(proposalId);
    if (!entry) {
      throw new LimitOrderExpiredError(
        `Limit order proposal not found: ${proposalId}. Create a fresh proposal and try again.`,
      );
    }
    if (Date.now() - entry.storedAt > BASKET_TTL_MS) {
      this.proposals.delete(proposalId);
      throw new LimitOrderExpiredError(
        `Limit order proposal expired: ${proposalId}. Create a fresh proposal and try again.`,
      );
    }
    return entry.proposal;
  }

  attachPrepared(prepared: PreparedLimitOrder): void {
    const entry = this.proposals.get(prepared.proposalId);
    if (!entry) {
      throw new LimitOrderExpiredError(
        `Limit order proposal not found: ${prepared.proposalId}`,
      );
    }
    entry.prepared = {
      prepared,
      expiresAt: prepared.expiresAt.getTime(),
    };
  }

  getPrepared(proposalId: string): PreparedLimitOrder {
    const entry = this.proposals.get(proposalId);
    if (!entry?.prepared) {
      throw new LimitOrderExpiredError(
        `Prepared limit order not found: ${proposalId}`,
      );
    }
    if (entry.prepared.expiresAt <= Date.now()) {
      delete entry.prepared;
      throw new LimitOrderExpiredError(
        `Prepared limit order expired: ${proposalId}`,
      );
    }
    return entry.prepared.prepared;
  }

  deleteProposal(proposalId: string): void {
    this.proposals.delete(proposalId);
  }

  setCancel(prepared: PreparedLimitCancel): void {
    this.cancels.set(prepared.orderKey, {
      prepared,
      expiresAt: prepared.expiresAt.getTime(),
    });
  }

  getCancel(orderKey: string): PreparedLimitCancel {
    const entry = this.cancels.get(orderKey);
    if (!entry) {
      throw new LimitOrderExpiredError(
        `Prepared cancel not found for order ${orderKey}`,
      );
    }
    if (entry.expiresAt <= Date.now()) {
      this.cancels.delete(orderKey);
      throw new LimitOrderExpiredError(
        `Prepared cancel expired for order ${orderKey}`,
      );
    }
    return entry.prepared;
  }

  deleteCancel(orderKey: string): void {
    this.cancels.delete(orderKey);
  }
}
