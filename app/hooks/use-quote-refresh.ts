'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useExecutionStore } from '@/store';
import type { QuoteResponse, TradeIntent } from '@/types';
import type { TradeFlowStatus } from './use-quote-execution';

const SIGNING_STATUSES: TradeFlowStatus[] = [
  'preparing',
  'signing',
  'confirming',
  'submitted',
  'confirmed',
];

function isQuoteExpired(quote?: QuoteResponse) {
  return quote ? new Date(quote.expiresAt).getTime() <= Date.now() : false;
}

function secondsUntilExpiry(quote?: QuoteResponse) {
  if (!quote) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 1000),
  );
}

/**
 * Keeps a live market quote fresh by silently re-quoting when it expires.
 * Pauses during prepare/sign/confirm so the wallet never signs a replaced route.
 */
export function useQuoteRefresh(options: {
  enabled?: boolean;
  flowStatus?: TradeFlowStatus;
  /** Seed an external quote (e.g. agent artifact) into the store for refresh. */
  seedQuote?: QuoteResponse;
  seedIntent?: TradeIntent;
}) {
  const { enabled = true, flowStatus = 'idle', seedQuote, seedIntent } =
    options;
  const quote = useExecutionStore((state) => state.quote);
  const lastQuoteIntent = useExecutionStore((state) => state.lastQuoteIntent);
  const isRefreshingQuote = useExecutionStore(
    (state) => state.isRefreshingQuote,
  );
  const refreshQuote = useExecutionStore((state) => state.refreshQuote);
  const seedQuoteIntoStore = useExecutionStore((state) => state.seedQuote);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    secondsUntilExpiry(quote ?? seedQuote),
  );
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshInFlight = useRef(false);
  const signing = SIGNING_STATUSES.includes(flowStatus);

  useEffect(() => {
    if (!seedQuote) return;
    const current = useExecutionStore.getState().quote;
    if (current?.id === seedQuote.id) return;
    seedQuoteIntoStore(seedQuote, seedIntent);
  }, [seedIntent, seedQuote, seedQuoteIntoStore]);

  const activeQuote = quote ?? seedQuote;
  const canRefresh = Boolean(enabled && lastQuoteIntent && !signing);

  const runRefresh = useCallback(async (manual = false) => {
    if (!canRefresh || refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshFailed(false);
    const next = await refreshQuote({ manual });
    refreshInFlight.current = false;
    if (!next) setRefreshFailed(true);
  }, [canRefresh, refreshQuote]);

  useEffect(() => {
    if (!activeQuote) return;

    const tick = window.setInterval(() => {
      setSecondsLeft(secondsUntilExpiry(activeQuote));
    }, 1000);

    return () => window.clearInterval(tick);
  }, [activeQuote]);

  useEffect(() => {
    if (!enabled || !activeQuote || signing || isRefreshingQuote) return;
    if (!isQuoteExpired(activeQuote)) return;
    if (!lastQuoteIntent) return;
    const timeout = window.setTimeout(() => {
      void runRefresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    activeQuote,
    enabled,
    isRefreshingQuote,
    lastQuoteIntent,
    runRefresh,
    secondsLeft,
    signing,
  ]);

  return {
    quote: activeQuote,
    secondsLeft,
    expired: isQuoteExpired(activeQuote),
    isRefreshingQuote,
    refreshFailed,
    /** User-initiated retry (priority lane). */
    refreshQuote: () => runRefresh(true),
  };
}

export { isQuoteExpired, secondsUntilExpiry };
