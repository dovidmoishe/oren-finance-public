"use client";

import { RefreshCwIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarketChart, type MarketChartMode, type MarketChartRange } from "@/components/charts/market-chart";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
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
} from "@/components/ui";
import { ActivityList } from "@/components/portfolio/activity-list";
import { usePortfolioRefresh } from "@/hooks/use-portfolio-refresh";
import { useOrenAuth } from "@/components/auth/auth-context";
import { usePortfolioStore, useWalletStore } from "@/store";
import type { PortfolioPosition, PortfolioRange } from "@/types";
import { useI18n, useT } from "@/i18n/i18n";

const chartRangeToPortfolioRange: Record<MarketChartRange, PortfolioRange> = {
  "24H": "1D",
  "7D": "1W",
  "30D": "1M",
  "90D": "3M",
  "1Y": "1Y",
};

function ChangePill({ value }: { value?: number }) {
  const { locale } = useI18n();
  const positive = (value ?? 0) >= 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-xs font-semibold shadow-sm",
        positive ? "text-foreground" : "text-negative",
      )}
    >
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(value ?? 0), locale, false)}
    </span>
  );
}

function normalizeLogoUrl(url?: string) {
  if (!url) return undefined;
  if (url.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function PositionLogo({ position }: { position: PortfolioPosition }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const logoUrl = normalizeLogoUrl(position.logoUrl);

  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={t("portfolio.logoAlt", { name: position.name })}
        className="h-10 w-10 rounded-full border border-border bg-panel object-contain p-1"
        onError={() => setFailed(true)}
        src={logoUrl}
      />
    );
  }

  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-panel-subtle font-mono text-xs font-semibold text-foreground">
      {position.ticker.slice(0, 2)}
    </div>
  );
}

function DetailMetric({
  label,
  value,
  detail,
  change,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  change?: number;
  className: string;
}) {
  const t = useT();
  return (
    <section className={cn("rounded-[24px] p-7 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", className)}>
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 text-xs text-foreground/65">{detail}</p>
      <p className="mt-7 font-display text-3xl font-semibold tracking-normal">{value}</p>
      <div className="mt-3 flex items-center gap-2 text-xs font-medium">
        <ChangePill value={change} />
        <span>{t("portfolio.thisWeek")}</span>
      </div>
    </section>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-[430px]" />
        <Skeleton className="h-[430px]" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton className="h-44" key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function ReturnPanel({
  value,
  rangeLabel,
  bars,
}: {
  value?: number;
  rangeLabel: string;
  bars: number[];
}) {
  const { locale, t } = useI18n();
  const maxBar = Math.max(...bars.map((bar) => Math.abs(bar)), 1);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{t("portfolio.roiTitle")}</p>
          <p className="mt-1 text-xs text-muted">{t("portfolio.roiSubtitle")}</p>
        </div>
        <span className="rounded-[10px] bg-panel-subtle px-3 py-1 text-xs font-semibold">{rangeLabel}</span>
      </CardHeader>
      <CardContent>
        <p className="font-display text-4xl font-semibold tracking-normal">
          {formatCurrency(Math.abs(value ?? 0), locale)}
        </p>
        <p className="mt-2 text-sm text-muted">{t("portfolio.roiBasis")}</p>
        {bars.length ? (
          <div className="mt-8 flex h-36 items-end gap-4 border-b border-foreground/25 pb-2">
            {bars.map((bar, index) => {
              const positive = bar >= 0;
              const height = Math.max(18, Math.round((Math.abs(bar) / maxBar) * 110));

              return (
                <div className="flex flex-1 flex-col items-center gap-2" key={`${bar}-${index}`}>
                  <div
                    className={cn(
                      "w-full max-w-5 rounded-full",
                      positive ? "bg-accent-yellow" : "bg-gradient-to-t from-foreground to-muted-2",
                    )}
                    style={{ height }}
                  />
                  <span className="text-[10px] text-muted">{index + 1}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-8 flex h-36 items-center justify-center rounded-[18px] border border-dashed border-border bg-panel-subtle text-center text-xs text-muted">
            {t("portfolio.roiEmpty")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PortfolioDashboard() {
  const auth = useOrenAuth();
  const { locale, timeZone, t } = useI18n();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const portfolio = usePortfolioStore((state) => state.portfolio);
  const history = usePortfolioStore((state) => state.history);
  const activity = usePortfolioStore((state) => state.activity);
  const isLoading = usePortfolioStore((state) => state.isLoading);
  const error = usePortfolioStore((state) => state.error);
  const reset = usePortfolioStore((state) => state.reset);
  const [range, setRange] = useState<MarketChartRange>("7D");
  const [chartMode, setChartMode] = useState<MarketChartMode>("line");
  const refresh = usePortfolioRefresh(chartRangeToPortfolioRange[range]);

  useEffect(() => {
    if (!wallet || !connected) {
      reset();
      return;
    }

    void refresh();
  }, [connected, refresh, reset, wallet]);

  const chartData = useMemo(
    () =>
      history.map((snapshot) => ({
        timestamp: snapshot.timestamp,
        value: snapshot.totalValueUsd,
      })),
    [history],
  );

  const returnBars = useMemo(() => {
    if (history.length < 2) return [];
    const recent = history.slice(-7);

    return recent.slice(1).map((snapshot, index) => {
      const previous = recent[index]?.totalValueUsd ?? snapshot.totalValueUsd;
      return snapshot.totalValueUsd - previous;
    });
  }, [history]);

  const handleRangeChange = (nextRange: MarketChartRange) => {
    setRange(nextRange);
  };

  useEffect(() => {
    if (wallet && connected) {
      void refresh();
    }
  }, [connected, range, refresh, wallet]);

  if (!connected) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-5">
          <p className="text-sm text-muted">{t("portfolio.eyebrow")}</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">{t("portfolio.title")}</h1>
        </div>
        <EmptyState
          action={
            !auth.ready ? null : auth.authenticated
              ? auth.error && <Button disabled={auth.busy} onClick={() => void auth.createWallet()}>{t("portfolio.retryWallet")}</Button>
              : <Button onClick={auth.open}>{t("portfolio.signIn")}</Button>
          }
          description={!auth.ready ? t("portfolio.restoringDescription") : auth.authenticated ? auth.error || t("portfolio.preparingDescription") : t("portfolio.signedOutDescription")}
          title={!auth.ready ? t("portfolio.restoringTitle") : auth.authenticated ? auth.error ? t("portfolio.walletRetryTitle") : t("portfolio.preparingTitle") : t("portfolio.signedOutTitle")}
        />
      </div>
    );
  }

  if (isLoading && !portfolio) {
    return <PortfolioSkeleton />;
  }

  const positiveChange = (portfolio?.changeUsd ?? 0) >= 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{t("portfolio.eyebrow")}</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">{t("portfolio.title")}</h1>
        </div>
        <Link className="text-sm font-semibold underline underline-offset-4" href="/app/portfolio">
          {t("portfolio.viewDetails")}
        </Link>
      </div>

      {error ? <ErrorState description={error} onRetry={() => void refresh()} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <MarketChart
          activeRange={range}
          changePct={portfolio?.changePct}
          className="min-w-0 rounded-[24px]"
          dateLabel={portfolio ? formatDate(portfolio.updatedAt, locale, timeZone, t("common.notUpdated")) : undefined}
          lineData={chartData}
          loading={isLoading && history.length === 0}
          mode={chartMode}
          onModeChange={setChartMode}
          onRangeChange={handleRangeChange}
          value={portfolio?.totalValueUsd}
        />
        <ReturnPanel bars={returnBars} rangeLabel={range} value={portfolio?.changeUsd} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="font-display text-3xl font-semibold tracking-normal">{t("portfolio.detailsTitle")}</h2>
        <Button disabled={isLoading} onClick={() => void refresh()} variant="secondary">
          <HugeiconsIcon className={cn(isLoading && "animate-spin")} color="currentColor" icon={RefreshCwIcon} size={16} strokeWidth={1.8} />
          {t("portfolio.refresh")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <DetailMetric
          change={portfolio?.changePct}
          className="bg-accent-yellow"
          detail={t("portfolio.availableDetail")}
          label={t("portfolio.availableLabel")}
          value={formatCurrency(portfolio?.availableValueUsd, locale)}
        />
        <DetailMetric
          change={portfolio?.changePct}
          className="bg-accent-pink"
          detail={t("portfolio.lockedDetail")}
          label={t("portfolio.lockedLabel")}
          value={formatCurrency(portfolio?.lockedValueUsd, locale)}
        />
        <DetailMetric
          change={0}
          className="bg-accent-lavender"
          detail={t("portfolio.cashDetail")}
          label={t("portfolio.cashLabel")}
          value={formatCurrency(portfolio?.cashValueUsd, locale)}
        />
      </div>

      <p className="text-sm text-muted">
        <Link className="font-semibold text-foreground underline-offset-2 hover:underline" href="/app/vault">
          {t("portfolio.openVault")}
        </Link>
        {" "}
        {t("portfolio.vaultNote")}
      </p>

      <div className="grid gap-4 ">
        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">{t("portfolio.positions")}</h2>
            <p className="text-sm text-muted">{t("portfolio.positionsSubtitle")}</p>
          </CardHeader>
          <div className="overflow-x-auto">
            {portfolio?.positions.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portfolio.colAsset")}</TableHead>
                    <TableHead>{t("portfolio.colGain")}</TableHead>
                    <TableHead>{t("portfolio.colAvailable")}</TableHead>
                    <TableHead>{t("portfolio.colLocked")}</TableHead>
                    <TableHead>{t("portfolio.colPrice")}</TableHead>
                    <TableHead className="text-right">{t("portfolio.colBalance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portfolio.positions.map((position) => (
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
                      <TableCell>
                        <span className={cn((position.change24hPct ?? 0) < 0 ? "text-negative" : "text-positive")}>
                          {formatPercent(position.change24hPct, locale)}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono">{formatNumber(position.availableQuantity, locale)}</TableCell>
                      <TableCell className="font-mono">{formatNumber(position.lockedQuantity, locale)}</TableCell>
                      <TableCell>{formatCurrency(position.priceUsd, locale)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(position.valueUsd, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4">
                <EmptyState
                  description={t("portfolio.noPositionsDescription")}
                  title={t("portfolio.noPositionsTitle")}
                />
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold">{t("portfolio.activity")}</h2>
              <p className="text-sm text-muted">{t("portfolio.activitySubtitle")}</p>
            </div>
            <Link className="text-sm font-semibold underline underline-offset-4" href="/app/activity">
              {t("portfolio.viewAll")}
            </Link>
          </CardHeader>
          <CardContent>
            <ActivityList items={activity.slice(0, 6)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
