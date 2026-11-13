'use client';
import { useCallback, useRef, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { approveServerTrade, getServerApproval, forgetApproval } from '@/services/approval-service';
import { ApiError } from '@/services/api-client';
import { walletSessionIsCurrent } from '@/services/wallet-session';
import type { LimitOrderProposal } from '@/types';
import type { TradeFlowStatus } from './use-quote-execution';
import { usePortfolioRefresh } from './use-portfolio-refresh';
export function useLimitOrderExecution(onConfirmed?: () => Promise<void> | void) {
  const { address, getAccessToken, authorizeTrade } = useOrenAuth();
  const refreshPortfolio = usePortfolioRefresh();
  const [flowStatus, setFlowStatus] = useState<TradeFlowStatus>('idle');
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<{ signature: string; orderKey?: string }>();
  const busy = useRef(false);
  const generation = useRef(0);
  const execute = useCallback(async (approvalId: string, referenceId: string) => {
    if (!address || busy.current) return;
    const sessionCurrent = walletSessionIsCurrent();
    const attempt = ++generation.current;
    const current = () => sessionCurrent() && attempt === generation.current;
    busy.current = true; setError(undefined); let submissionStarted = false;
    try {
      setFlowStatus('signing');
      const token = await getAccessToken();
      if (!current()) return;
      const authorizationSignature = await authorizeTrade(approvalId, token);
      if (!current()) return;
      submissionStarted = true; const result = await approveServerTrade(approvalId, token, address, authorizationSignature);
      if (!current()) return;
      if (result.wallet !== address || result.referenceId !== referenceId) throw new Error('Approval does not match this order.');
      if (result.status === 'failed') throw new Error('Order failed. Review a fresh proposal.');
      if (result.signature) setConfirmation({ signature: result.signature, orderKey: result.details.orderKey });
      setFlowStatus('submitted'); setError(result.message);
      for (let i = 0; i < 30 && current(); i++) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        if (!current()) return;
        try {
          const state = await getServerApproval(approvalId, await getAccessToken());
          if (!current()) return;
          if (state.status === 'failed') { forgetApproval(approvalId); setError('The order transaction failed on-chain.'); setFlowStatus('failed'); return; }
          if (state.status === 'confirmed') {
            forgetApproval(approvalId);
            setFlowStatus('confirmed'); setError(undefined);
            await Promise.all([refreshPortfolio(), onConfirmed?.()]); return;
          }
        } catch { /* Remain submitted when confirmation is unavailable. */ }
      }
    } catch (error) {
      if (current()) {
        const rejected = !submissionStarted || error instanceof ApiError && ([400, 401, 403, 404].includes(error.status) || (error.details as { code?: string })?.code === 'PRIVY_SIGNING_FAILED');
        if (rejected) forgetApproval(approvalId);
        setError(rejected ? (error instanceof Error ? error.message : 'Unable to authorize this trade.') : 'Order status is uncertain. Check the pending trade notice before retrying.');
        setFlowStatus(rejected ? 'failed' : 'submitted');
      }
    } finally { busy.current = false; }
  }, [address, getAccessToken, authorizeTrade, onConfirmed, refreshPortfolio]);
  const executeLimitOrder = useCallback((proposal: LimitOrderProposal, approvalId: string) => execute(approvalId, proposal.id), [execute]);
  const cancelLimitOrder = useCallback((orderKey: string, approvalId: string) => execute(approvalId, orderKey), [execute]);
  const resetFeedback = useCallback(() => { generation.current++; setFlowStatus('idle'); setError(undefined); setConfirmation(undefined); }, []);
  return { confirmation, error, executeLimitOrder, cancelLimitOrder, flowStatus, resetFeedback, setError, setFlowStatus };
}
