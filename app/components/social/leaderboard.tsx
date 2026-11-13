"use client";

import {
  ArrowUpRight01Icon,
  Medal01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  cn,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
} from "@/components/ui";
import {
  normalizeTraderSlug,
  requestVisibilityChallenge,
  updateTraderVisibility,
} from "@/services";
import { useSocialStore, useWalletStore } from "@/store";
import type { LeaderboardRow, SocialTimeframe } from "@/types";
import { useI18n, useT } from "@/i18n/i18n";

const timeframes: SocialTimeframe[] = ["7D", "30D", "90D", "ALL"];
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function TraderAvatar({ row }: { row: LeaderboardRow }) {
  if (row.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${row.displayName} avatar`}
        className="h-10 w-10 rounded-full border border-border object-cover"
        src={row.avatarUrl}
      />
    );
  }

  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-foreground font-display text-sm font-semibold text-white">
      {row.displayName.slice(0, 2).toUpperCase()}
    </div>
  );
}

function PnlText({ row }: { row: LeaderboardRow }) {
  const { locale } = useI18n();
  const positive = row.pnlPct >= 0;
  return (
    <div className={cn("font-mono font-semibold", positive ? "text-positive" : "text-negative")}>
      {positive ? "▲" : "▼"} {formatPercent(Math.abs(row.pnlPct), locale, false)}
    </div>
  );
}

function MetricBand({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  className: string;
}) {
  return (
    <section className={cn("rounded-[24px] p-4 text-foreground shadow-[0_18px_60px_rgba(23,23,23,0.05)]", className)}>
      <p className="text-base font-semibold">{label}</p>
      <p className="mt-1 text-xs text-foreground/65">{detail}</p>
      <p className="mt-7 font-display text-3xl font-semibold tracking-normal">{value}</p>
    </section>
  );
}

function PublishProfilePanel({ onPublished }: { onPublished: () => void }) {
  const walletAddress = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const { signMessage } = useWallet();
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const t = useT();
  const normalizedDisplay = displayName.trim() || "Oren Trader";
  const normalizedSlug = normalizeTraderSlug(slug || normalizedDisplay, walletAddress);

  const handlePublish = async () => {
    if (!walletAddress || !connected) {
      setError(t("leaderboard.walletNotReady"));
      return;
    }
    if (!signMessage) {
      setError(t("leaderboard.noSigning"));
      return;
    }

    setIsSubmitting(true);
    setError(undefined);
    setStatus(undefined);

    try {
      const { message } = await requestVisibilityChallenge(walletAddress, {
        isPublic: true,
        displayName: normalizedDisplay,
        slug: normalizedSlug,
      });
      const signature = await signMessage(new TextEncoder().encode(message));
      await updateTraderVisibility(walletAddress, {
        message,
        signature: encodeBase58(signature),
      });
      setStatus(t("leaderboard.published"));
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("leaderboard.publishFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-display text-lg font-semibold">{t("leaderboard.goPublic")}</h2>
        <p className="mt-1 text-sm text-muted">{t("leaderboard.goPublicSubtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="block text-xs font-semibold text-muted">
          {t("leaderboard.displayName")}
          <input
            className="mt-1 h-11 w-full rounded-[14px] border border-border bg-panel-subtle px-3 text-sm text-foreground outline-none focus:border-border-strong"
            maxLength={48}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Oren Trader"
            value={displayName}
          />
        </label>
        <label className="block text-xs font-semibold text-muted">
          {t("leaderboard.slug")}
          <input
            className="mt-1 h-11 w-full rounded-[14px] border border-border bg-panel-subtle px-3 text-sm text-foreground outline-none focus:border-border-strong"
            maxLength={48}
            onChange={(event) => setSlug(event.target.value)}
            placeholder={normalizedSlug}
            value={slug}
          />
        </label>
        <p className="text-xs text-muted">{t("leaderboard.publicUrl", { url: `/leaderboard/${normalizedSlug || "trader"}` })}</p>
        {error ? <p className="rounded-[12px] bg-red-50 p-3 text-xs text-red-900">{error}</p> : null}
        {status ? <p className="rounded-[12px] bg-green-50 p-3 text-xs text-green-900">{status}</p> : null}
        <Button className="w-full" disabled={isSubmitting || !connected} onClick={handlePublish} variant="primary">
          {isSubmitting ? t("leaderboard.signing") : t("leaderboard.publish")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function Leaderboard() {
  const timeframe = useSocialStore((state) => state.timeframe);
  const leaderboard = useSocialStore((state) => state.leaderboard);
  const isLoading = useSocialStore((state) => state.isLoading);
  const error = useSocialStore((state) => state.error);
  const loadLeaderboard = useSocialStore((state) => state.loadLeaderboard);
  const { locale, t } = useI18n();

  useEffect(() => {
    void loadLeaderboard("30D");
  }, [loadLeaderboard]);

  const rows = leaderboard?.rows ?? [];
  const stats = leaderboard?.stats;
  const topName = stats?.topPerformer?.displayName ?? t("leaderboard.noLeader");
  const topReturn = stats?.topPerformer ? formatPercent(stats.topPerformer.pnlPct, locale) : "0.00%";
  const averageReturn = formatPercent(stats?.averagePnlPct ?? 0, locale);

  const skeletonRows = useMemo(() => Array.from({ length: 8 }), []);

  return (
    <div className="mx-auto max-w-[1540px] space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{t("leaderboard.eyebrow")}</p>
          <h1 className="font-display text-4xl font-semibold tracking-normal">{t("leaderboard.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {t("leaderboard.intro")}
          </p>
        </div>
        <Tabs ariaLabel={t("leaderboard.timeframe")} items={timeframes} onValueChange={(value) => void loadLeaderboard(value)} value={timeframe} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricBand className="bg-accent-yellow" detail={topName} label={t("leaderboard.topPerformer")} value={topReturn} />
        <MetricBand className="bg-accent-pink" detail={t("leaderboard.optedIn")} label={t("leaderboard.publicTraders")} value={formatNumber(stats?.totalPublicTraders ?? 0, locale, 0)} />
        <MetricBand className="bg-accent-lavender" detail={t("leaderboard.observedReturn", { timeframe })} label={t("leaderboard.averagePnl")} value={averageReturn} />
      </div>

      {error ? <ErrorState description={error} onRetry={() => void loadLeaderboard(timeframe)} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold">{t("leaderboard.topWallets")}</h2>
              <p className="mt-1 text-sm text-muted">{t("leaderboard.rankedBy", { timeframe })}</p>
            </div>
            <HugeiconsIcon className="text-muted" color="currentColor" icon={Medal01Icon} size={22} strokeWidth={1.8} />
          </CardHeader>

          <div className="hidden overflow-x-auto md:block">
            <div className="grid min-w-[940px] grid-cols-[80px_minmax(240px,1.3fr)_130px_130px_150px_150px_120px] bg-panel-subtle/70 px-4 py-3 text-xs font-semibold text-foreground">
              <div>{t("leaderboard.rank")}</div>
              <div>{t("leaderboard.trader")}</div>
              <div>{t("leaderboard.pnlPct")}</div>
              <div>{t("leaderboard.pnlUsd")}</div>
              <div>{t("leaderboard.portfolio")}</div>
              <div>{t("leaderboard.topHolding")}</div>
              <div>{t("leaderboard.risk")}</div>
            </div>
            {isLoading && rows.length === 0
              ? skeletonRows.map((_, index) => <Skeleton className="mx-4 my-3 h-14" key={index} />)
              : rows.map((row) => <LeaderboardTableRow key={row.slug} row={row} />)}
          </div>

          <div className="space-y-3 p-4 md:hidden">
            {isLoading && rows.length === 0
              ? skeletonRows.slice(0, 4).map((_, index) => <Skeleton className="h-32" key={index} />)
              : rows.map((row) => <LeaderboardMobileRow key={row.slug} row={row} />)}
          </div>

          {!isLoading && rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                description={t("leaderboard.emptyDescription")}
                title={t("leaderboard.emptyTitle")}
              />
            </div>
          ) : null}
        </Card>

        <div className="space-y-5">
          <PublishProfilePanel onPublished={() => void loadLeaderboard(timeframe)} />
          <Card>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-full bg-foreground text-white">
                  <HugeiconsIcon color="currentColor" icon={UserGroupIcon} size={20} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="font-display text-lg font-semibold">{t("leaderboard.copyTitle")}</p>
                  <p className="text-xs leading-5 text-muted">{t("leaderboard.copyBody")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function LeaderboardTableRow({ row }: { row: LeaderboardRow }) {
  const { locale, t } = useI18n();
  return (
    <Link
      className="grid min-w-[940px] grid-cols-[80px_minmax(240px,1.3fr)_130px_130px_150px_150px_120px] items-center border-t border-border px-4 py-4 text-sm transition-colors hover:bg-panel-subtle"
      href={`/app/leaderboard/${row.slug}`}
    >
      <div className="font-display text-xl font-semibold">#{row.rank}</div>
      <div className="flex min-w-0 items-center gap-3">
        <TraderAvatar row={row} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.displayName}</p>
          <p className="font-mono text-xs text-muted">{row.walletPreview}</p>
        </div>
      </div>
      <PnlText row={row} />
      <div className={cn("font-mono", row.pnlUsd >= 0 ? "text-positive" : "text-negative")}>{formatCurrency(row.pnlUsd, locale)}</div>
      <div className="font-mono">{formatCurrency(row.totalValueUsd, locale)}</div>
      <div className="font-mono">{row.topHolding?.ticker ?? t("leaderboard.none")}</div>
      <div className="capitalize">{row.riskLabel}</div>
    </Link>
  );
}

function LeaderboardMobileRow({ row }: { row: LeaderboardRow }) {
  const { locale, timeZone, t } = useI18n();
  return (
    <Link className="block rounded-[20px] border border-border bg-panel p-4 shadow-sm" href={`/app/leaderboard/${row.slug}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TraderAvatar row={row} />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">#{row.rank} {row.displayName}</p>
            <p className="font-mono text-xs text-muted">{row.walletPreview}</p>
          </div>
        </div>
        <HugeiconsIcon color="currentColor" icon={ArrowUpRight01Icon} size={17} strokeWidth={1.8} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <Metric label={t("leaderboard.pnl")} value={`${formatPercent(row.pnlPct, locale)} · ${formatCurrency(row.pnlUsd, locale)}`} />
        <Metric label={t("leaderboard.portfolio")} value={formatCurrency(row.totalValueUsd, locale)} />
        <Metric label={t("leaderboard.topHolding")} value={row.topHolding?.ticker ?? t("leaderboard.none")} />
        <Metric label={t("leaderboard.updated")} value={formatDate(row.updatedAt, locale, timeZone, t("common.notUpdated"))} />
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-panel-subtle p-3">
      <p className="text-muted">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground">{value}</p>
    </div>
  );
}

function encodeBase58(bytes: Uint8Array) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  for (const byte of bytes) {
    if (byte === 0) digits.push(0);
    else break;
  }

  return digits.reverse().map((digit) => base58Alphabet[digit]).join("");
}
