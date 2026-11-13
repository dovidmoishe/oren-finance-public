"use client";

import { useEffect, useState } from 'react';
import { FundingStreamError, streamFunding, type FundingSnapshot } from '@/services/funding-stream';
import { usePortfolioStore, useWalletStore } from '@/store';

export type FundingStatus = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'unavailable';
export function useFunding(wallet: string, getAccessToken: () => Promise<string | null>) {
  const [snapshot, setSnapshot] = useState<FundingSnapshot>();
  const [status, setStatus] = useState<FundingStatus>('connecting');
  const [error, setError] = useState<string>();
  const [received, setReceived] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let previous: FundingSnapshot | undefined;
    let latestSlot = 0;

    async function connect() {
      if (disposed || document.hidden) return;
      const current = new AbortController();
      controller = current;
      try {
        await streamFunding(wallet, getAccessToken, (event) => {
          if (disposed || current.signal.aborted) return;
          if (event.type === 'snapshot') {
            if (event.data.slot < latestSlot) return;
            latestSlot = event.data.slot;
            if (previous && (BigInt(event.data.usdcAtomic) > BigInt(previous.usdcAtomic) || BigInt(event.data.solLamports) > BigInt(previous.solLamports))) {
              setReceived(true);
              if (useWalletStore.getState().address === wallet) void usePortfolioStore.getState().loadPortfolio(wallet);
            }
            previous = event.data;
            attempts = 0;
            setSnapshot(event.data);
            setError(undefined);
          } else if (event.type === 'status') setStatus(event.status);
        }, current.signal);
      } catch (cause) {
        if (disposed || current.signal.aborted) return;
        if (cause instanceof FundingStreamError && !cause.retryable) {
          setStatus('unavailable'); setError(cause.message); return;
        }
      }
      if (disposed || current.signal.aborted || document.hidden) return;
      setStatus('reconnecting');
      setError('Connection interrupted. Balances may be out of date while we reconnect.');
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5)) * (0.8 + Math.random() * 0.4);
      retryTimer = setTimeout(() => void connect(), delay);
    }

    const visibility = () => {
      controller?.abort(); clearTimeout(retryTimer);
      if (document.hidden) setStatus('paused');
      else { setStatus('connecting'); void connect(); }
    };
    document.addEventListener('visibilitychange', visibility);
    void connect();
    return () => { disposed = true; controller?.abort(); clearTimeout(retryTimer); document.removeEventListener('visibilitychange', visibility); };
  }, [wallet, getAccessToken, revision]);

  return { snapshot, status, error, received, retry: () => { setError(undefined); setStatus('connecting'); setRevision((value) => value + 1); } };
}
