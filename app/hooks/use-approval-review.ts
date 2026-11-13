'use client';
import { financialExecutionEnabled } from '@/services/environment';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { prepareServerApproval, type ApprovalKind, type TradeApproval } from '@/services/approval-service';
import { priceMovedFrom } from '@/services/price-moved';
import type { PriceMovedDetails } from '@/types';
export function useApprovalReview(kind: ApprovalKind, referenceId: string | undefined, open: boolean) {
  const { address, getAccessToken } = useOrenAuth();
  const [state, setState] = useState<{ approval?: TradeApproval; error?: string; priceMoved?: PriceMovedDetails; loading: boolean }>({ loading: false });
  const [now, setNow] = useState(Date.now);
  const generation = useRef<symbol | undefined>(undefined);
  const prepare = useCallback(async () => {
    const attempt = Symbol();
    generation.current = attempt;
    if (!financialExecutionEnabled || !open || !address || !referenceId) return;
    setState({ loading: true });
    try {
      const token = await getAccessToken();
      if (attempt !== generation.current) return;
      const approval = await prepareServerApproval({ kind, referenceId, wallet: address }, token);
      if (attempt === generation.current) setState({ approval, loading: false });
    } catch (error) {
      if (attempt !== generation.current) return;
      // PRICE_MOVED is not an error to retry: the user must re-review.
      const priceMoved = priceMovedFrom(error);
      setState(priceMoved
        ? { priceMoved, loading: false }
        : { error: error instanceof Error ? error.message : 'Unable to prepare your trade.', loading: false });
    }
  }, [address, getAccessToken, kind, open, referenceId]);
  useEffect(() => {
    const timeout = window.setTimeout(() => void prepare(), 0);
    return () => { generation.current = undefined; window.clearTimeout(timeout); };
  }, [prepare]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);
  const candidate = state.approval;
  const approval = candidate && candidate.wallet === address && candidate.referenceId === referenceId ? candidate : undefined;
  const priceMoved = state.priceMoved?.quoteId === referenceId ? state.priceMoved : undefined;
  return { ...state, approval, priceMoved, prepare, expired: Boolean(approval && new Date(approval.expiresAt).getTime() <= now), secondsLeft: approval ? Math.max(0, Math.ceil((new Date(approval.expiresAt).getTime() - now) / 1000)) : 0 };
}
