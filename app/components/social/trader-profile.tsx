"use client";

import { financialExecutionEnabled } from "@/services/environment";

import {
  ArrowLeft01Icon,
  Briefcase01Icon,
  CoinsSwapIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketChart, type MarketChartMode, type MarketChartRange } from "@/components/charts";
import { BasketReview } from "@/components/trading";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/components/ui";
import { useExecutionStore, useSocialStore, useWalletStore } from "@/store";
import type { PortfolioPosition } from "@/types";
import { useI18n, useT } from "@/i18n/i18n";

function TraderAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={`${name} avatar`} className="h-14 w-14 rounded-full border border-border object-cover" src={avatarUrl} />
    );
  }

  return (
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-foreground font-display text-lg font-semibold text-white">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function PositionLogo({ position }: { position: PortfolioPosition }) {
  const t = useT();
  if (position.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={t("trader.logoAlt", { name: position.name })} className="h-8 w-8 rounded-full border border-border object-contain p-1" src={position.logoUrl} />
    );
  }

  return (
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-subtle font-mono text-[10px] font-semibold">
      {position.ticker.slice(0, 2)}
    </div>
  );
}

function DetailMetric({ label, value, detail, className }: { label: string; value: string; detail: string; className: string }) {
  return (
    <section className={cn("rounded-[24px] p-4 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", className)}>
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 text-xs text-foreground/65">{detail}</p>
      <p className="mt-7 font-display text-3xl font-semibold tracking-normal">{value}</p>
    </section>
  );
}

function CopyPortfolioDrawer({ slug }: { slug: string }) {
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const proposal = useSocialStore((state) => state.copyProposal);
  const isCopying = useSocialStore((state) => state.isCopying);
  const copyError = useSocialStore((state) => state.copyError);
  const prepareCopy = useSocialStore((state) => state.prepareCopy);
  const clearCopy = useSocialStore((state) => state.clearCopy);
  const preparedBasket = useExecutionStore((state) => state.preparedBasket);
  const executionError = useExecutionStore((state) => state.error);
  const executionLoading = useExecutionStore((state) => state.isLoading);
  const prepareBasketTrades = useExecutionStore((state) => state.prepareBasketTrades);
  const resetAll = useExecutionStore((state) => state.resetAll);
  const [open, setOpen] = useState(false);
  const [amountUsd, setAmountUsd] = useState("100");
  const t = useT();

  const close = () => {
    setOpen(false);
    clearCopy();
    resetAll();
  };

  const handlePrepareCopy = async () => {
    if (!wallet || !connected) return;
    await prepareCopy({
      sourceSlug: slug,
      wallet,
      amountUsd: Number(amountUsd),
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="primary">
        <HugeiconsIcon color="currentColor" icon={CoinsSwapIcon} size={16} strokeWidth={1.8} />
        {t("trader.copyPortfolio")}
      </Button>
      <Modal onClose={close} open={open} side="right" title={t("trader.copyPortfolio")}>
        <div className="space-y-4">
          <div className="rounded-[18px] border border-border bg-panel-subtle p-4">
            <p className="text-sm font-semibold">{t("trader.chooseAmount")}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{t("trader.chooseAmountNote")}</p>
            <label className="mt-4 block text-xs font-semibold text-muted">
              {t("trader.usdcAmount")}
              <input
                className="mt-1 h-11 w-full rounded-[14px] border border-border bg-panel px-3 font-mono text-sm text-foreground outline-none focus:border-border-strong"
                min="5"
                onChange={(event) => setAmountUsd(event.target.value)}
                step="1"
                type="number"
                value={amountUsd}
              />
            </label>
            <Button className="mt-4 w-full" disabled={!financialExecutionEnabled || !connected || isCopying} onClick={handlePrepareCopy} variant="primary">
              {isCopying ? t("trader.building") : t("trader.build")}
            </Button>
          </div>

          {copyError ? <p className="rounded-[12px] bg-red-50 p-3 text-xs text-red-900">{copyError}</p> : null}

          {proposal ? (
            <>
              <BasketReview basket={proposal.basket} progress={preparedBasket?.progress} />
              {proposal.skippedAssets.length ? (
                <div className="rounded-[18px] border border-border bg-panel-subtle p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{t("trader.skipped")}</p>
                  <div className="mt-2 space-y-2">
                    {proposal.skippedAssets.slice(0, 4).map((asset, index) => (
                      <p className="text-xs text-muted" key={`${asset.assetId}-${index}`}>
                        {asset.ticker ?? t("trader.asset")}: {asset.reason}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              {executionError ? <p className="rounded-[12px] bg-red-50 p-3 text-xs text-red-900">{executionError}</p> : null}
              <Button
                className="w-full"
                disabled={!financialExecutionEnabled || !wallet || executionLoading}
                onClick={() => wallet && void prepareBasketTrades({ basketId: proposal.basket.id, wallet })}
                variant="secondary"
              >
                {executionLoading ? (
                  <HugeiconsIcon className="animate-spin" color="currentColor" icon={Loading03Icon} size={15} strokeWidth={1.8} />
                ) : null}
                {t("trader.prepareQuotes")}
              </Button>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export function TraderProfile({ slug }: { slug: string }) {
  const trader = useSocialStore((state) => state.selectedTrader);
  const timeframe = useSocialStore((state) => state.timeframe);
  const isLoading = useSocialStore((state) => state.isLoading);
  const error = useSocialStore((state) => state.error);
  const loadTrader = useSocialStore((state) => state.loadTrader);
  const [chartMode, setChartMode] = useState<MarketChartMode>("line");
  const [chartRange, setChartRange] = useState<MarketChartRange>("30D");
  const { locale, timeZone, t } = useI18n();

  useEffect(() => {
    void loadTrader(slug, "30D");
  }, [loadTrader, slug]);

  const chartData = useMemo(
    () =>
      trader?.history.points.map((point) => ({
        timestamp: point.timestamp,
        value: point.totalValueUsd,
      })) ?? [],
    [trader],
  );

  if (isLoading && !trader) {
    return (
      <div className="mx-auto max-w-[1540px] space-y-5 pb-20">
        <Skeleton className="h-32" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-[520px]" />
          <Skeleton className="h-[520px]" />
        </div>
      </div>
    );
  }

  if (!trader) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <ErrorState description={error ?? t("trader.loadFailed")} onRetry={() => void loadTrader(slug, timeframe)} title={t("trader.unavailable")} />
      </div>
    );
  }

  const positions = trader.portfolio.positions;
  const positive = trader.stats.pnlPct >= 0;

  return (
    <div className="mx-auto max-w-[1540px] space-y-6 pb-20">
      <Link className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground" href="/app/leaderboard">
        <HugeiconsIcon color="currentColor" icon={ArrowLeft01Icon} size={16} strokeWidth={1.8} />
        {t("trader.back")}
      </Link>

      <section className="flex flex-wrap items-end justify-between gap-4 rounded-[24px] border border-border bg-panel p-4 shadow-[0_18px_60px_rgba(23,23,23,0.04)]">
        <div className="flex min-w-0 items-center gap-4">
          <TraderAvatar avatarUrl={trader.profile.avatarUrl} name={trader.profile.displayName} />
          <div className="min-w-0">
            <p className="text-sm text-muted">{t("trader.rank", { rank: trader.stats.rank, wallet: trader.profile.walletPreview })}</p>
            <h1 className="truncate font-display text-4xl font-semibold tracking-normal">{trader.profile.displayName}</h1>
            {trader.profile.bio ? <p className="mt-1 max-w-2xl text-sm text-muted">{trader.profile.bio}</p> : null}
          </div>
        </div>
        <CopyPortfolioDrawer slug={slug} />
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <DetailMetric className="bg-accent-yellow" detail={t("trader.observedReturn", { timeframe: trader.timeframe })} label={t("trader.pnl")} value={`${positive ? "+" : ""}${formatPercent(trader.stats.pnlPct, locale, false)}`} />
        <DetailMetric className="bg-accent-pink" detail={t("trader.observedValue")} label={t("trader.portfolio")} value={formatCurrency(trader.portfolio.totalValueUsd, locale)} />
        <DetailMetric className="bg-accent-lavender" detail={t("trader.observedPnl")} label={t("trader.netChange")} value={formatCurrency(trader.stats.pnlUsd, locale)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <MarketChart
          activeRange={chartRange}
          changePct={trader.stats.pnlPct}
          className="min-w-0 rounded-[24px]"
          dateLabel={formatDate(trader.stats.updatedAt, locale, timeZone, t("common.notUpdated"))}
          emptyDescription={t("trader.chartEmpty")}
          lineData={chartData}
          mode={chartMode}
          onModeChange={setChartMode}
          onRangeChange={setChartRange}
          value={trader.portfolio.totalValueUsd}
        />
        <Card>
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">{t("trader.allocation")}</h2>
            <p className="mt-1 text-sm text-muted">{t("trader.allocationSubtitle")}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {positions.length ? (
              positions.slice(0, 6).map((position) => (
                <div className="space-y-2" key={position.assetId}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{position.ticker}</span>
                    <span className="font-mono">{formatPercent(position.allocationPct, locale, false)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-subtle">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.min(100, Math.max(0, position.allocationPct))}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState description={t("trader.noHoldingsDescription")} title={t("trader.noHoldings")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-display text-xl font-semibold">{t("trader.holdings")}</h2>
            <p className="mt-1 text-sm text-muted">{t("trader.holdingsSubtitle")}</p>
          </CardHeader>
          {positions.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("trader.asset")}</TableHead>
                    <TableHead>{t("trader.allocation")}</TableHead>
                    <TableHead>{t("trader.quantity")}</TableHead>
                    <TableHead>{t("trader.price")}</TableHead>
                    <TableHead className="text-right">{t("trader.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((position) => (
                    <TableRow className="transition-colors hover:bg-panel-subtle/70" key={position.assetId}>
                      <TableCell>
                        <Link className="flex min-w-[220px] items-center gap-3" href={`/app/stocks/${position.assetId}`}>
                          <PositionLogo position={position} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{position.name}</div>
                            <div className="font-mono text-xs text-muted">{position.ticker}</div>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono">{formatPercent(position.allocationPct, locale, false)}</TableCell>
                      <TableCell className="font-mono">{formatNumber(position.quantity, locale)}</TableCell>
                      <TableCell>{formatCurrency(position.priceUsd, locale)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(position.valueUsd, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState description={t("trader.noHoldingsYetDescription")} title={t("trader.noHoldingsYet")} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
