'use client';

import {
  Activity01Icon,
  ArrowUpRight01Icon,
  Briefcase01Icon,
  ChartLineData01Icon,
  Clock01Icon,
  CoinsSwapIcon,
  SafeIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import Link from 'next/link';
import { useEffect } from 'react';
import type {
  AgentArtifact,
  AgentArtifactDensity,
  BasketResponse,
  LimitOrderProposal,
  QuoteResponse,
} from '@/types';
import { TechnicalBriefPanel } from '@/components/stock/technical-brief-panel';
import { Button, cn, formatCurrency, formatNumber } from '@/components/ui';
import { useI18n } from '@/i18n/i18n';
import { useQuoteRefresh } from '@/hooks/use-quote-refresh';
import { useExecutionStore } from '@/store';
import { BasketProposal } from '@/components/trading/basket-proposal';
import { MarketSessionNotice } from '@/components/trading/market-session-notice';

interface AgentArtifactsProps {
  artifacts: AgentArtifact[];
  density?: AgentArtifactDensity;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
}

export function AgentArtifacts({
  artifacts,
  density = 'inline',
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
}: AgentArtifactsProps) {
  const { locale } = useI18n();
  if (density === 'chips') {
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {artifacts.map((artifact, index) => (
          <span
            className="rounded-full border border-border bg-panel-subtle px-2.5 py-1 text-[11px] font-semibold text-muted"
            key={`${artifact.type}-${index}`}
          >
            {artifactChipLabel(artifact, locale)}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('mt-3', density === 'rail' ? 'space-y-4' : 'space-y-3')}>
      {artifacts.map((artifact, index) => (
        <AgentArtifactCard
          artifact={artifact}
          density={density}
          key={`${artifact.type}-${index}`}
          onNavigate={onNavigate}
          onReviewBasket={onReviewBasket}
          onReviewLimitOrder={onReviewLimitOrder}
          onReviewQuote={onReviewQuote}
        />
      ))}
    </div>
  );
}

function AgentArtifactCard({
  artifact,
  density = 'inline',
  onReviewQuote,
  onReviewBasket,
  onReviewLimitOrder,
  onNavigate,
}: {
  artifact: AgentArtifact;
  density?: AgentArtifactDensity;
  onReviewQuote: (quote: QuoteResponse) => void;
  onReviewBasket: (basket: BasketResponse) => void;
  onReviewLimitOrder: (proposal: LimitOrderProposal) => void;
  onNavigate?: () => void;
}) {
  const { locale } = useI18n();
  switch (artifact.type) {
    case 'research': {
      const report = artifact.data;
      return <div className="rounded-2xl border border-border bg-panel p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Stock research</p>
        <h3 className="mt-1 font-display text-base font-semibold">{report.name} · {report.ticker}</h3>
        <p className="mt-2 text-sm leading-6 text-muted">{report.analysis.data?.summary ?? 'Analysis is unavailable.'}</p>
        <p className="mt-2 text-xs text-muted">{report.opinions.data ? `${report.opinions.data.distinctAuthors} cited writers · ${report.opinions.data.coverage} coverage` : 'Writer views unavailable'}{report.portfolio.data ? ` · ${report.portfolio.data.allocationPercent.toFixed(1)}% of your portfolio` : ''}</p>
        <Link className="mt-3 inline-block text-sm font-medium underline-offset-2 hover:underline" href={`/app/stocks/${encodeURIComponent(report.assetId)}`} onClick={onNavigate}>Open research view</Link>
      </div>;
    }
    case 'portfolio': {
      const portfolio = artifact.data;
      return (
        <ArtifactShell icon={Briefcase01Icon} label="Portfolio" tone="pink">
          <p className="font-display text-2xl font-semibold">
            {formatCurrency(portfolio.totalValueUsd, locale)}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Available" value={formatCurrency(portfolio.availableValueUsd, locale)} />
            <Metric label="Locked" value={formatCurrency(portfolio.lockedValueUsd, locale)} />
          </div>
          {portfolio.positions.length ? (
            <div className="mt-3 space-y-2 border-t border-black/8 pt-3">
              {portfolio.positions.slice(0, 3).map((position) => (
                <div className="flex items-center justify-between text-xs" key={position.assetId}>
                  <span className="font-semibold">{position.ticker}</span>
                  <span className="font-mono">
                    {formatCurrency(position.valueUsd, locale)} ·{' '}
                    {portfolio.totalValueUsd > 0
                      ? `${formatNumber((position.valueUsd / portfolio.totalValueUsd) * 100, locale, 0)}%`
                      : '0%'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </ArtifactShell>
      );
    }
    case 'stock': {
      const stock = artifact.data;
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Stock snapshot" tone="plain">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-xl font-semibold">{stock.ticker}</p>
              <p className="text-xs text-muted">{stock.name}</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-semibold">
                {stock.priceUsd === undefined ? '—' : formatCurrency(stock.priceUsd, locale)}
              </p>
              <p className={cn('text-xs', (stock.change24hPct ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
                {stock.change24hPct === undefined
                  ? 'No daily change'
                  : `${stock.change24hPct >= 0 ? '+' : ''}${formatNumber(stock.change24hPct, locale, 2)}%`}
              </p>
            </div>
          </div>
          <Link
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold"
            href={`/app/stocks/${stock.assetId}`}
            onClick={onNavigate}
          >
            Open stock <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={1.8} />
          </Link>
        </ArtifactShell>
      );
    }
    case 'analysis': {
      const analysis = artifact.data;
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Oren analysis" tone="lavender">
          <div>
            <p className="font-display text-xl font-semibold">{analysis.ticker}</p>
            <p className="mt-1 text-xs capitalize text-muted">
              {analysis.riskLabel ? `${analysis.riskLabel} risk` : 'Risk profile unavailable'}
            </p>
          </div>
          {analysis.summary ? (
            <p className="mt-3 text-xs leading-5 text-muted">{analysis.summary}</p>
          ) : null}
          <details className="mt-3 rounded-[15px] border border-black/8 bg-white/40 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted">Show details</summary>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Oren Score</p>
              <span className="font-display text-lg font-semibold">{Math.round(analysis.opportunityScore)}</span>
            </div>
            {analysis.technicalBrief ? (
              <div className="mt-3 border-t border-black/8 pt-3">
                <TechnicalBriefPanel brief={analysis.technicalBrief} compact={density !== 'rail'} />
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Metric label="RSI" value={formatSignal(analysis.signals.rsi14, locale)} />
                <Metric label="30d momentum" value={formatPercentSignal(analysis.signals.momentum30d, locale)} />
                <Metric label="30d volatility" value={formatPercentSignal(analysis.signals.volatility30d, locale)} />
              </div>
            )}
            {analysis.highlights.length ? (
              <div className="mt-3 border-t border-black/8 pt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Signals &amp; strengths
                </p>
                <ul className="space-y-1.5 text-xs leading-5">
                {analysis.highlights.slice(0, 3).map((highlight) => (
                  <li className="flex gap-2" key={highlight}>
                    <span aria-hidden>•</span><span>{highlight}</span>
                  </li>
                ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 text-[11px] leading-4 text-muted">
              Risk: {analysis.riskLabel ?? 'unclassified'}. Scores are deterministic signals, not a guarantee of returns.
            </p>
          </details>
        </ArtifactShell>
      );
    }
    case 'bitget_market': {
      const context = artifact.data;
      const quote = context.quote;
      const change = quote?.change24hPct;
      const observedAt = new Date(context.source.observedAt);
      return (
        <ArtifactShell icon={Activity01Icon} label="Bitget Reality" tone="plain">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-xl font-semibold">
                {context.symbol ? formatBitgetSymbol(context.symbol) : context.ticker}
              </p>
              <p className="mt-1 text-xs text-muted">
                {context.available
                  ? `Live tokenized-stock venue · ${context.range}`
                  : context.reason === 'BITGET_REALITY_SYMBOL_UNAVAILABLE'
                    ? 'No matching Bitget Reality market'
                    : 'Live Bitget context unavailable'}
              </p>
            </div>
            {quote ? (
              <div className="text-right">
                <p className="font-mono font-semibold">{formatCurrency(quote.lastPriceUsd, locale)}</p>
                <p className={cn('text-xs', (change ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
                  {change === undefined ? '24h —' : `${change >= 0 ? '+' : ''}${formatNumber(change, locale, 2)}%`}
                </p>
              </div>
            ) : null}
          </div>
          {quote ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Metric
                label="24h turnover"
                value={quote.turnover24hUsd === undefined ? '—' : formatCurrency(quote.turnover24hUsd, locale)}
              />
              <Metric
                label="Bid / ask spread"
                value={quote.spreadBps === undefined ? '—' : `${formatNumber(quote.spreadBps, locale, 1)} bps`}
              />
            </div>
          ) : null}
          {context.comparison ? (
            <div className="mt-2 flex items-center justify-between rounded-[14px] bg-panel-subtle px-3 py-2 text-xs">
              <span className="text-muted">vs Oren reference</span>
              <span className="font-mono font-semibold">
                {context.comparison.differencePct >= 0 ? '+' : ''}
                {formatNumber(context.comparison.differencePct, locale, 2)}%
              </span>
            </div>
          ) : null}
          {context.trading ? (
            <p className="mt-3 text-[11px] leading-4 text-muted">
              {context.trading.weekendTradable ? 'Weekend trading supported' : 'Standard supported sessions'}
              {context.trading.supportedPeriods.length
                ? ` · ${context.trading.supportedPeriods.map(formatSession).join(', ')}`
                : ''}
            </p>
          ) : null}
          <p className="mt-2 text-[10px] text-muted-2">
            Bitget Reality · {context.source.stale ? 'cached fallback' : 'observed'}{' '}
            {Number.isNaN(observedAt.getTime()) ? '' : observedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
          {context.warnings?.length ? (
            <p className="mt-2 rounded-[12px] bg-[#fff9c9] px-3 py-2 text-[10px] leading-4 text-muted">
              {context.warnings.join(' ')}
            </p>
          ) : null}
        </ArtifactShell>
      );
    }
    case 'opportunities':
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Top opportunities" tone="yellow">
          <div className="space-y-2">
            {artifact.data.slice(0, 5).map((stock, index) => (
              <Link
                className="flex items-center justify-between rounded-[14px] bg-white/70 px-3 py-2 text-xs hover:bg-white"
                href={`/app/stocks/${stock.assetId}`}
                key={stock.assetId}
                onClick={onNavigate}
              >
                <span><span className="mr-2 text-muted">{index + 1}</span><strong>{stock.ticker}</strong></span>
                <span className="font-mono font-semibold">{Math.round(stock.opportunityScore ?? 0)}</span>
              </Link>
            ))}
          </div>
        </ArtifactShell>
      );
    case 'quote':
      return <QuoteArtifact key={artifact.data.id} onReview={onReviewQuote} quote={artifact.data} />;
    case 'limit_order':
      return (
        <ArtifactShell icon={CoinsSwapIcon} label="Limit order proposal" tone="lavender">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-muted capitalize">
                {artifact.data.side} limit
              </p>
              <p className="font-display text-xl font-semibold">{artifact.data.ticker}</p>
            </div>
            <p className="font-mono text-sm font-semibold">
              {formatCurrency(artifact.data.limitPriceUsd, locale)}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-black/8 pt-3 text-xs">
            <span className="text-muted">Notional</span>
            <span className="font-mono">{formatCurrency(artifact.data.amountUsd, locale)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-muted">If filled</span>
            <span className="font-mono">
              {formatNumber(artifact.data.takingAmount, locale, 6)} {artifact.data.outputSymbol}
            </span>
          </div>
          <MarketSessionNotice session={artifact.data.marketSession} variant="note" />
          {artifact.data.wouldFillImmediately ? (
            <p className="mt-3 rounded-[13px] bg-white/60 px-3 py-2 text-[11px] leading-4 text-muted">
              This limit is already through market — it may fill right after you sign.
            </p>
          ) : null}
          <Button
            className="mt-4 h-10 w-full rounded-[14px]"
            onClick={() => onReviewLimitOrder(artifact.data)}
            variant="primary"
          >
            Review limit order
          </Button>
        </ArtifactShell>
      );
    case 'limit_orders':
      return (
        <ArtifactShell icon={Clock01Icon} label="Limit orders" tone="plain">
          {artifact.data.length === 0 ? (
            <p className="text-xs text-muted">No open limit orders for this wallet.</p>
          ) : (
            <div className="space-y-2">
              {artifact.data.slice(0, 5).map((order) => (
                <div
                  className="flex items-center justify-between rounded-[14px] bg-white/70 px-3 py-2 text-xs"
                  key={order.orderKey}
                >
                  <span>
                    <strong className="capitalize">{order.side}</strong>{' '}
                    {order.ticker ?? '—'} @ {formatCurrency(order.limitPriceUsd, locale)}
                  </span>
                  <span className="font-mono capitalize text-muted">{order.status}</span>
                </div>
              ))}
            </div>
          )}
        </ArtifactShell>
      );
    case 'basket':
      return (
        <BasketProposal basket={artifact.data} onReview={onReviewBasket} />
      );
    case 'copy_portfolio_proposal':
      return (
        <ArtifactShell icon={Briefcase01Icon} label="Copy portfolio" tone="lavender">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Copying {artifact.data.source.displayName}</p>
              <p className="font-display text-xl font-semibold">{formatCurrency(artifact.data.amountUsd, locale)}</p>
            </div>
            <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-semibold">
              {artifact.data.allocations.length} stocks
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {artifact.data.allocations.map((allocation) => (
              <span className="rounded-full bg-white/75 px-2 py-1 text-[11px] font-semibold" key={allocation.assetId}>
                {allocation.ticker} {formatNumber(allocation.weightPercent, locale, 0)}%
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">{artifact.data.riskCopy}</p>
          <MarketSessionNotice session={artifact.data.basket.marketSession} variant="note" />
          <Button className="mt-4 h-10 w-full rounded-[14px]" onClick={() => onReviewBasket(artifact.data.basket)} variant="primary">
            Review copy basket
          </Button>
        </ArtifactShell>
      );
    case 'trading_calendar':
      return (
        <ArtifactShell icon={ChartLineData01Icon} label="Trading calendar" tone="yellow">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">{artifact.data.range.month ?? `${artifact.data.range.start} to ${artifact.data.range.end}`}</p>
              <p className="font-display text-xl font-semibold">
                {formatCurrency(artifact.data.days.reduce((sum, day) => sum + day.pnlUsd, 0), locale)}
              </p>
            </div>
            <span className="rounded-full bg-white/75 px-2 py-1 text-xs font-semibold">
              {artifact.data.days.filter((day) => day.hasData).length} days
            </span>
          </div>
          <Link className="mt-4 inline-flex items-center gap-1 text-xs font-semibold" href="/app/calendar">
            Open calendar <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={1.8} />
          </Link>
        </ArtifactShell>
      );
    case 'trading_calendar_day':
      return (
        <ArtifactShell icon={Activity01Icon} label="Calendar day" tone="plain">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted">{artifact.data.date}</p>
              <p className="font-display text-xl font-semibold">{formatCurrency(artifact.data.summary.pnlUsd, locale)}</p>
            </div>
            <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', artifact.data.summary.pnlUsd >= 0 ? 'bg-accent-yellow' : 'bg-accent-pink')}>
              {formatNumber(artifact.data.summary.returnPct, locale, 2)}%
            </span>
          </div>
          {artifact.data.contributors.length ? (
            <div className="mt-3 space-y-2 border-t border-black/8 pt-3">
              {artifact.data.contributors.slice(0, 3).map((item) => (
                <div className="flex items-center justify-between text-xs" key={item.assetId}>
                  <span className="font-semibold">{item.ticker}</span>
                  <span className="font-mono">{formatCurrency(item.valueChangeUsd, locale)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </ArtifactShell>
      );
        case 'vaults': {
      const nextUnlock = [...artifact.data.positions].sort(
        (a, b) => new Date(a.unlockAt).getTime() - new Date(b.unlockAt).getTime(),
      )[0];
      return (
        <ArtifactShell icon={SafeIcon} label="Vault" tone="lavender">
          <p className="font-display text-2xl font-semibold">{formatCurrency(artifact.data.totalLockedValueUsd, locale)}</p>
          <p className="mt-1 text-xs text-muted">
            {artifact.data.positions.length} locked position{artifact.data.positions.length === 1 ? '' : 's'}
            {nextUnlock ? ` · next unlock ${nextUnlock.ticker ?? 'asset'}` : ''}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            Vault UI preview is available, but the onchain program is not live yet so locks cannot be signed.
          </p>
        </ArtifactShell>
      );
    }
case 'prepared_swap':
    case 'prepared_basket':
    case 'prepared_lock':
    case 'prepared_unlock':
      return (
        <ArtifactShell icon={SafeIcon} label="Prepared action" tone="plain">
          <p className="text-sm font-semibold">Wallet review required</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            Oren prepared unsigned transaction data. A fresh review artifact is required before anything can be signed.
          </p>
        </ArtifactShell>
      );
  }
}

function QuoteArtifact({
  quote,
  onReview,
}: {
  quote: QuoteResponse;
  onReview: (quote: QuoteResponse) => void;
}) {
  const { locale } = useI18n();
  const seedQuote = useExecutionStore((state) => state.seedQuote);
  const storeQuote = useExecutionStore((state) => state.quote);
  const {
    secondsLeft,
    expired,
    isRefreshingQuote,
    refreshFailed,
    refreshQuote,
  } = useQuoteRefresh({
    enabled: true,
    seedQuote: quote,
  });

  useEffect(() => {
    seedQuote(quote);
  }, [quote, seedQuote]);

  const liveQuote =
    storeQuote?.id === quote.id ||
    (storeQuote?.assetId === quote.assetId &&
      storeQuote?.side === quote.side &&
      storeQuote?.amountUsd === quote.amountUsd)
      ? storeQuote
      : quote;

  return (
    <ArtifactShell icon={CoinsSwapIcon} label="Executable quote" tone="yellow">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-muted">{liveQuote.side}</p>
          <p className="font-display text-xl font-semibold">{liveQuote.ticker}</p>
        </div>
        <p className="font-mono text-sm font-semibold">{formatCurrency(liveQuote.amountUsd, locale)}</p>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-black/8 pt-3 text-xs">
        <span className="text-muted">Estimated receive</span>
        <span className="font-mono">{formatNumber(liveQuote.outputAmount, locale, 6)} {liveQuote.outputSymbol}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted">Price impact</span>
        <span className="font-mono">{formatNumber(liveQuote.priceImpactPercent, locale, 2)}%</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-muted">Quote expiry</span>
        <span className="font-mono">
          {isRefreshingQuote
            ? 'Updating…'
            : expired
              ? 'Refreshing…'
              : `${secondsLeft}s left`}
        </span>
      </div>
      <MarketSessionNotice session={liveQuote.marketSession} variant="note" />
      <p className="mt-3 rounded-[13px] bg-white/60 px-3 py-2 text-[11px] leading-4 text-muted">
        {refreshFailed
          ? 'Could not refresh this quote. Retry to keep it actionable.'
          : isRefreshingQuote || expired
            ? 'Updating the live route so you can still review and sign.'
            : 'Live quotes can move before signing. Review route, expiry, and wallet details before approval.'}
      </p>
      {refreshFailed ? (
        <Button
          className="mt-4 h-10 w-full rounded-[14px]"
          onClick={() => void refreshQuote()}
          variant="secondary"
        >
          <HugeiconsIcon icon={Clock01Icon} size={15} strokeWidth={1.8} />
          Retry quote refresh
        </Button>
      ) : (
        <Button
          className="mt-4 h-10 w-full rounded-[14px]"
          disabled={isRefreshingQuote || expired}
          onClick={() => onReview(liveQuote)}
          variant="primary"
        >
          <HugeiconsIcon
            icon={isRefreshingQuote || expired ? Clock01Icon : CoinsSwapIcon}
            size={15}
            strokeWidth={1.8}
          />
          {isRefreshingQuote || expired ? 'Updating quote…' : 'Review quote'}
        </Button>
      )}
    </ArtifactShell>
  );
}

function ArtifactShell({
  icon,
  label,
  tone,
  children,
}: {
  icon: IconSvgElement;
  label: string;
  tone: 'plain' | 'pink' | 'yellow' | 'lavender';
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-[20px] border border-black/8 p-4 shadow-[0_12px_34px_rgba(23,23,23,0.05)]',
        tone === 'plain' && 'bg-panel',
        tone === 'pink' && 'bg-accent-pink-soft',
        tone === 'yellow' && 'bg-[#fff9c9]',
        tone === 'lavender' && 'bg-[#f1edff]',
      )}
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        <HugeiconsIcon icon={icon} size={13} strokeWidth={1.8} />
        {label}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-white/70 p-3">
      <p className="text-muted">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatSignal(value: number | undefined, locale: string) {
  return value === undefined ? '—' : formatNumber(value, locale, 1);
}

function formatPercentSignal(value: number | undefined, locale: string) {
  return value === undefined ? '—' : `${value >= 0 ? '+' : ''}${formatNumber(value, locale, 1)}%`;
}

function artifactChipLabel(artifact: AgentArtifact, locale: string): string {
  switch (artifact.type) {
    case 'research':
      return `${artifact.data.ticker} research`;
    case 'portfolio':
      return `Portfolio ${formatCurrency(artifact.data.totalValueUsd, locale)}`;
    case 'stock':
      return artifact.data.ticker;
    case 'analysis':
      return `${artifact.data.ticker} analysis`;
    case 'bitget_market':
      return artifact.data.symbol
        ? `Bitget ${formatBitgetSymbol(artifact.data.symbol)}`
        : `Bitget ${artifact.data.ticker}`;
    case 'opportunities':
      return `${artifact.data.length} opportunities`;
    case 'quote':
      return `${artifact.data.side} ${artifact.data.ticker}`;
    case 'limit_order':
      return `${artifact.data.side} ${artifact.data.ticker} limit`;
    case 'limit_orders':
      return `${artifact.data.length} limit orders`;
    case 'basket':
      return `Basket ${formatCurrency(artifact.data.totalAmountUsd, locale)}`;
    case 'copy_portfolio_proposal':
      return `Copy ${artifact.data.source.displayName}`;
    case 'trading_calendar':
      return 'Trading calendar';
    case 'trading_calendar_day':
      return artifact.data.date;
    case 'vaults':
      return 'Vault positions';
    case 'prepared_swap':
    case 'prepared_basket':
    case 'prepared_lock':
    case 'prepared_unlock':
      return 'Prepared action';
  }
}

function formatBitgetSymbol(symbol: string): string {
  const normalized = symbol.toUpperCase();
  const base = normalized.endsWith('USDT') ? normalized.slice(0, -4) : normalized;
  const realityTicker = base.startsWith('R') ? `r${base.slice(1)}` : base;
  return normalized.endsWith('USDT') ? `${realityTicker}/USDT` : realityTicker;
}

function formatSession(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
