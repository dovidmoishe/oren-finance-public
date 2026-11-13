'use client';

import { useEffect, useState } from 'react';
import { useOrenAuth } from '@/components/auth/auth-context';
import { QuoteReviewModal } from '@/components/trading/quote-review-modal';
import { useQuoteExecution } from '@/hooks/use-quote-execution';
import { getExecutionQuote } from '@/services/execution-service';
import { mcpApiOrigin } from '@/services/mcp-api-origin';
import type { QuoteResponse } from '@/types';

type Intent = {
  id: string;
  assetId: string;
  ticker: string;
  side: 'buy' | 'sell';
  stockMint?: string;
  amountUsd?: number;
  amountShares?: number;
  slippageBps: number;
  wallet: string;
  expiresAt: string;
};

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function BrowserTradeReview({ intentId }: { intentId: string }) {
  const auth = useOrenAuth();
  const { authenticated, address, getAccessToken, open } = auth;
  const [intent, setIntent] = useState<Intent>();
  const [quote, setQuote] = useState<QuoteResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const execution = useQuoteExecution();
  const apiOrigin = mcpApiOrigin();

  useEffect(() => {
    if (!authenticated || !address || !apiOrigin) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Sign in again to review this request.');
        const response = await fetch(`${apiOrigin}/mcp/intents/${encodeURIComponent(intentId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('This request expired or is unavailable.');
        const data = (await response.json()) as Intent;
        if (data.id !== intentId || data.wallet !== address || new Date(data.expiresAt).getTime() <= Date.now())
          throw new Error('This request expired or is unavailable.');
        if (!cancelled) setIntent(data);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load request.');
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, address, apiOrigin, getAccessToken, intentId]);

  async function loadQuote() {
    if (!intent || !address || loading) return;
    setLoading(true);
    setError(undefined);
    setQuote(undefined);
    execution.resetFeedback();
    try {
      if (new Date(intent.expiresAt).getTime() <= Date.now())
        throw new Error('This request expired. Ask the agent for a new one.');
      const result = await getExecutionQuote({
        side: intent.side,
        assetId: intent.assetId,
        ticker: intent.ticker,
        amountUsd: intent.amountUsd,
        amount: intent.amountShares,
        preferredMint: intent.stockMint,
        slippageBps: intent.slippageBps,
        wallet: address,
      });
      if (
        result.side !== intent.side ||
        result.assetId !== intent.assetId ||
        (intent.stockMint && result.variant.mint !== intent.stockMint) ||
        (intent.side === 'buy' &&
          (result.inputMint !== USDC_MINT || Math.abs(result.amountUsd - (intent.amountUsd ?? 0)) > 0.000001)) ||
        (intent.side === 'sell' &&
          (result.outputMint !== USDC_MINT || Math.abs(result.inputAmount - (intent.amountShares ?? 0)) > 0.000000001)) ||
        result.slippageBps > intent.slippageBps
      )
        throw new Error('The quote does not match this request.');
      setQuote(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to get a quote.');
    } finally {
      setLoading(false);
    }
  }

  async function signReviewedQuote(approvalId: string, reviewedQuote: QuoteResponse) {
    if (!apiOrigin || !intent) return;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sign in again before approving this trade.');
      const response = await fetch(
        `${apiOrigin}/mcp/intents/${encodeURIComponent(intent.id)}/approval/${encodeURIComponent(approvalId)}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error('This approval no longer matches the agent request. Get a fresh quote.');
      await execution.executeQuote(reviewedQuote, approvalId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to approve this trade.');
    }
  }

  return <main className="mx-auto max-w-xl px-5 py-12">
    <h1 className="text-3xl font-semibold">Review agent {intent?.side ?? 'trade'} request</h1>
    <p className="mt-3 text-muted">Oren will show a fresh quote and ask you to authorize the exact transaction in your wallet.</p>
    {!authenticated && <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white" onClick={open} type="button">Sign in with email code</button>}
    {intent && <div className="mt-6 rounded-2xl border border-border bg-panel p-5">
      <p>Stock: {intent.assetId}</p>
      <p>{intent.side === 'buy' ? `Spend: $${intent.amountUsd?.toFixed(2)} USDC` : `Sell: ${intent.amountShares} shares`}</p>
      <p>Maximum slippage: {(intent.slippageBps / 100).toFixed(2)}%</p>
      <p className="mt-3 text-sm text-muted">Expires {new Date(intent.expiresAt).toLocaleTimeString()}</p>
    </div>}
    {error && <p className="mt-5 text-sm text-red-700" role="alert">{error}</p>}
    {intent && <button className="mt-6 rounded-xl bg-foreground px-5 py-3 text-white disabled:opacity-50" disabled={loading} onClick={() => void loadQuote()} type="button">{loading ? 'Getting quote…' : quote ? 'Refresh quote' : 'Get quote to review'}</button>}
    <QuoteReviewModal
      open={Boolean(quote)}
      quote={quote}
      status={execution.flowStatus}
      confirmation={execution.confirmation}
      error={execution.error ?? error}
      onClose={() => setQuote(undefined)}
      onSign={signReviewedQuote}
    />
  </main>;
}
