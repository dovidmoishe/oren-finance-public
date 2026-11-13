'use client';
import { useCallback, useRef, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { approveServerTrade, getServerApproval, forgetApproval } from '@/services/approval-service';
import { ApiError } from '@/services/api-client';
import { walletSessionIsCurrent } from '@/services/wallet-session';
import type { ExecutionStatus, QuoteResponse } from '@/types';
import { usePortfolioRefresh } from './use-portfolio-refresh';
export type TradeFlowStatus = 'idle' | 'quoted' | 'preparing' | 'signing' | 'confirming' | 'submitted' | 'confirmed' | 'failed';
export function useQuoteExecution(onConfirmed?: () => Promise<void> | void) {
  const { address, getAccessToken, authorizeTrade } = useOrenAuth();
  const refreshPortfolio = usePortfolioRefresh();
  const [flowStatus, setFlowStatus] = useState<TradeFlowStatus>('idle');
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<ExecutionStatus>();
  const busy = useRef(false);
  const generation = useRef(0);
  const executeQuote = useCallback(async (quote: QuoteResponse | undefined, approvalId: string) => {
    if (!address || !quote || busy.current) return;
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
      if (result.wallet !== address || result.referenceId !== quote.id) throw new Error('Approval does not match the reviewed trade.');
      if (result.status === 'failed') throw new Error('This transaction failed. Request a fresh quote.');
      if (result.signature) setConfirmation({ executionId: result.executionId, quoteId: quote.id, wallet: address, signature: result.signature, status: 'submitted', trackingStatus: 'pending' });
      setFlowStatus('submitted');
      if (result.message) setError(result.message);
      void (async () => {
        for (let i = 0; i < 30 && current(); i++) {
          await new Promise(resolve => window.setTimeout(resolve, 2000));
          if (!current()) return;
          try {
            const state = await getServerApproval(approvalId, await getAccessToken());
            if (!current()) return;
            if (state.status === 'failed') { forgetApproval(approvalId); setError('The transaction failed on-chain.'); setFlowStatus('failed'); return; }
            if (state.status === 'confirmed') {
              forgetApproval(approvalId);
              setError(undefined); setFlowStatus('confirmed');
              await Promise.all([refreshPortfolio(), onConfirmed?.()]); return;
            }
          } catch { /* Never repeat a trade because its status response was lost. */ }
        }
      })();
    } catch (error) {
      if (current()) {
        const rejected = !submissionStarted || error instanceof ApiError && ([400, 401, 403, 404].includes(error.status) || (error.details as { code?: string })?.code === 'PRIVY_SIGNING_FAILED');
        if (rejected) forgetApproval(approvalId);
        setError(rejected ? (error instanceof Error ? error.message : 'Unable to authorize this trade.') : 'Trade status is uncertain. Use the pending trade notice to check before retrying.');
        setFlowStatus(rejected ? 'failed' : 'submitted');
      }
    } finally { busy.current = false; }
  }, [address, getAccessToken, authorizeTrade, onConfirmed, refreshPortfolio]);
  const resetFeedback = useCallback(() => { generation.current++; setFlowStatus('idle'); setError(undefined); setConfirmation(undefined); }, []);
  return { confirmation, error, executeQuote, flowStatus, resetFeedback, setError, setFlowStatus };
}
