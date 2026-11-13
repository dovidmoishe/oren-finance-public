"use client";

import { financialExecutionEnabled } from "@/services/environment";

import {
  AlertCircleIcon,
  Calendar03Icon,
  Clock01Icon,
  RefreshCwIcon,
  SafeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
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
} from "@/components/ui";
import { usePortfolioStore, useVaultStore, useWalletStore } from "@/store";
import type { VaultPosition } from "@/types";
import { useI18n } from "@/i18n/i18n";
import { VaultReviewModal, type VaultReviewDetails } from "./vault-review-modal";

function defaultUnlockDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 90);
  return date.toISOString().slice(0, 10);
}

function minimumUnlockDate() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function daysUntil(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

function isEligible(unlockAt: string) {
  return new Date(unlockAt).getTime() <= Date.now();
}

function MetricTile({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-border p-4 shadow-[0_18px_60px_rgba(23,23,23,0.04)]",
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold tracking-normal">{value}</p>
      <p className="mt-2 text-sm text-muted">{detail}</p>
    </section>
  );
}

export function VaultDashboard() {
  const auth = useOrenAuth();
  const { locale, timeZone, t } = useI18n();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);

  const portfolio = usePortfolioStore((state) => state.portfolio);
  const loadPortfolio = usePortfolioStore((state) => state.loadPortfolio);

  const summary = useVaultStore((state) => state.summary);
  const positions = useVaultStore((state) => state.positions);
  const programLive = useVaultStore((state) => state.programLive);
  const isLoading = useVaultStore((state) => state.isLoading);
  const error = useVaultStore((state) => state.error);
  const loadVaults = useVaultStore((state) => state.loadVaults);
  const resetVault = useVaultStore((state) => state.reset);

  const [assetId, setAssetId] = useState("");
  const [amount, setAmount] = useState("");
  const [unlockDate, setUnlockDate] = useState(defaultUnlockDate);
  const [minUnlockDate] = useState(minimumUnlockDate);
  const [formError, setFormError] = useState<string>();
  const [review, setReview] = useState<VaultReviewDetails>();

  const lockable = useMemo(
    () => (portfolio?.positions ?? []).filter((position) => position.availableQuantity > 0),
    [portfolio?.positions],
  );
  const selected = lockable.find((position) => position.assetId === assetId) ?? lockable[0];

  useEffect(() => {
    if (!wallet || !connected) {
      resetVault();
      return;
    }
    void loadVaults(wallet);
    void loadPortfolio(wallet);
  }, [connected, loadPortfolio, loadVaults, resetVault, wallet]);

  const upcoming = useMemo(
    () =>
      [...positions]
        .sort((a, b) => new Date(a.unlockAt).getTime() - new Date(b.unlockAt).getTime())
        .slice(0, 3),
    [positions],
  );

  const parsedAmount = Number(amount);
  const estimatedValue =
    selected && Number.isFinite(parsedAmount) ? parsedAmount * selected.priceUsd : undefined;

  function validateLock() {
    if (!connected || !wallet) return auth.authenticated ? t("vault.walletPreparing") : t("vault.signInToPreview");
    if (!selected) return t("vault.noLockable");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return t("vault.amountPositive");
    }
    if (parsedAmount > selected.availableQuantity) {
      return t("vault.amountExceeds", { available: formatNumber(selected.availableQuantity, locale) });
    }
    if (!unlockDate) return t("vault.chooseDate");
    const unlockAt = new Date(`${unlockDate}T00:00:00.000Z`);
    if (Number.isNaN(unlockAt.getTime()) || unlockAt.getTime() <= Date.now()) {
      return t("vault.dateFuture");
    }
    return undefined;
  }

  function openLockReview() {
    const validationError = validateLock();
    setFormError(validationError);
    if (validationError || !selected) return;

    const unlockAt = new Date(`${unlockDate}T00:00:00.000Z`).toISOString();
    setReview({
      mode: "lock",
      ticker: selected.ticker,
      name: selected.name,
      quantity: parsedAmount,
      valueUsd: estimatedValue,
      unlockAt,
      daysRemaining: daysUntil(unlockAt),
    });
  }

  function openUnlockReview(position: VaultPosition) {
    const eligible = isEligible(position.unlockAt);
    if (!eligible) {
      setFormError(
        t("vault.earlyWithdraw", {
          ticker: position.ticker ?? t("vault.position"),
          count: position.daysRemaining ?? daysUntil(position.unlockAt),
        }),
      );
      return;
    }
    setFormError(undefined);
    setReview({
      mode: "unlock",
      ticker: position.ticker ?? t("vault.asset"),
      name: position.name,
      quantity: position.quantity,
      valueUsd: position.valueUsd,
      unlockAt: position.unlockAt,
      lockAddress: position.lockAddress,
      daysRemaining: 0,
    });
  }

  if (!connected) {
    return (
      <div className="space-y-4 px-4 py-4 sm:px-6">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">{t("vault.eyebrow")}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">{t("vault.title")}</h1>
        </header>
        <EmptyState
          title={!auth.ready ? t("vault.restoring") : auth.authenticated ? t("vault.preparing") : t("vault.signInTitle")}
          description={auth.authenticated ? auth.error || t("vault.preparingDescription") : t("vault.signInDescription")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">{t("vault.eyebrow")}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">{t("vault.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {t("vault.intro")}
          </p>
        </header>
        <Button
          disabled={!financialExecutionEnabled || isLoading || !wallet}
          onClick={() => {
            if (!wallet) return;
            void loadVaults(wallet);
            void loadPortfolio(wallet);
          }}
          variant="secondary"
        >
          <HugeiconsIcon
            className={cn(isLoading && "animate-spin")}
            color="currentColor"
            icon={RefreshCwIcon}
            size={16}
            strokeWidth={1.8}
          />
          {t("vault.refresh")}
        </Button>
      </div>

      {!programLive ? (
        <div className="rounded-[20px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex gap-3">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={SafeIcon} size={18} strokeWidth={1.8} />
            <div>
              <p className="font-semibold">{t("vault.offlineTitle")}</p>
              <p className="mt-1 leading-6 text-amber-900/85">
                {t("vault.offlineBody")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <ErrorState
          description={error}
          onRetry={() => wallet && void loadVaults(wallet)}
          title={t("vault.loadFailed")}
        />
      ) : null}

      {formError ? (
        <div className="rounded-[18px] border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="flex gap-3">
            <HugeiconsIcon className="mt-0.5 shrink-0" color="currentColor" icon={AlertCircleIcon} size={16} strokeWidth={1.8} />
            <p>{formError}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile
          className="bg-accent-pink"
          detail={programLive ? t("vault.indexedLocks") : t("vault.previewOnly")}
          label={t("vault.totalLocked")}
          value={isLoading && !summary ? "—" : formatCurrency(summary?.totalLockedValueUsd, locale)}
        />
        <MetricTile
          className="bg-accent-lavender"
          detail={t("vault.activeLockCount", { count: positions.length })}
          label={t("vault.activeLocks")}
          value={isLoading && !summary ? "—" : String(positions.length)}
        />
        <MetricTile
          className="bg-accent-yellow"
          detail={
            upcoming[0]
              ? `${upcoming[0].ticker ?? t("vault.asset")} · ${formatDate(upcoming[0].unlockAt, locale, timeZone, t("common.notUpdated"))}`
              : t("vault.noUpcoming")
          }
          label={t("vault.nextUnlock")}
          value={
            upcoming[0] ? t("vault.daysShort", { count: upcoming[0].daysRemaining ?? daysUntil(upcoming[0].unlockAt) }) : "—"
          }
        />
      </div>

      {upcoming.length ? (
        <Card>
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">{t("vault.upcomingTitle")}</h2>
            <p className="text-sm text-muted">{t("vault.upcomingSubtitle")}</p>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {upcoming.map((position) => (
              <div
                className="rounded-[18px] border border-border bg-panel-subtle p-4"
                key={position.lockAddress}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{position.ticker ?? t("vault.asset")}</p>
                  <span className="rounded-full bg-panel px-2.5 py-1 text-xs font-semibold">
                    {t("vault.daysShort", { count: position.daysRemaining ?? daysUntil(position.unlockAt) })}
                  </span>
                </div>
                <p className="mt-2 font-mono text-sm">
                  {formatNumber(position.quantity, locale)} · {formatCurrency(position.valueUsd, locale)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                  <HugeiconsIcon color="currentColor" icon={Calendar03Icon} size={12} strokeWidth={1.8} />
                  {formatDate(position.unlockAt, locale, timeZone, t("common.notUpdated"))}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">{t("vault.ticketTitle")}</h2>
            <p className="text-sm text-muted">{t("vault.ticketSubtitle")}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && !portfolio ? <Skeleton className="h-40" /> : null}
            {!isLoading && lockable.length === 0 ? (
              <EmptyState
                description={t("vault.noAvailableDescription")}
                title={t("vault.noAvailableTitle")}
              />
            ) : (
              <>
                <label className="block space-y-2 text-sm">
                  <span className="font-semibold">{t("vault.asset")}</span>
                  <select
                    className="h-11 w-full rounded-[14px] border border-border bg-panel px-3 font-medium outline-none focus:border-foreground"
                    onChange={(event) => setAssetId(event.target.value)}
                    value={selected?.assetId ?? ""}
                  >
                    {lockable.map((position) => (
                      <option key={position.assetId} value={position.assetId}>
                        {t("vault.availableOption", { ticker: position.ticker, available: formatNumber(position.availableQuantity, locale) })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{t("vault.amount")}</span>
                    <button
                      className="text-xs font-semibold text-muted hover:text-foreground"
                      onClick={() => selected && setAmount(String(selected.availableQuantity))}
                      type="button"
                    >
                      {t("vault.max", { amount: formatNumber(selected?.availableQuantity, locale) })}
                    </button>
                  </div>
                  <input
                    className="h-11 w-full rounded-[14px] border border-border bg-panel px-3 font-mono outline-none focus:border-foreground"
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    type="number"
                    value={amount}
                  />
                </label>

                <label className="block space-y-2 text-sm">
                  <span className="font-semibold">{t("vault.unlockDate")}</span>
                  <input
                    className="h-11 w-full rounded-[14px] border border-border bg-panel px-3 outline-none focus:border-foreground"
                    min={minUnlockDate}
                    onChange={(event) => setUnlockDate(event.target.value)}
                    type="date"
                    value={unlockDate}
                  />
                </label>

                <div className="rounded-[16px] border border-border bg-panel-subtle p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted">{t("vault.estimatedValue")}</span>
                    <span className="font-mono font-medium">{formatCurrency(estimatedValue, locale)}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    {t("vault.noEarlyWithdraw")}
                  </p>
                </div>

                <Button className="h-12 w-full rounded-[16px]" disabled={!financialExecutionEnabled} onClick={openLockReview} variant="primary">
                  <HugeiconsIcon color="currentColor" icon={SafeIcon} size={16} strokeWidth={1.8} />
                  {t("vault.reviewLock")}
                </Button>

                {!programLive ? (
                  <p className="flex items-start gap-2 text-xs leading-5 text-muted">
                    <HugeiconsIcon
                      className="mt-0.5 shrink-0"
                      color="currentColor"
                      icon={Clock01Icon}
                      size={14}
                      strokeWidth={1.8}
                    />
                    {t("vault.previewNote")}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-display text-lg font-semibold">{t("vault.activeLocks")}</h2>
            <p className="text-sm text-muted">{t("vault.activeSubtitle")}</p>
          </CardHeader>
          <div className="overflow-x-auto">
            {isLoading && positions.length === 0 ? (
              <div className="p-4">
                <Skeleton className="h-40" />
              </div>
            ) : positions.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  description={
                    programLive
                      ? t("vault.emptyLive")
                      : t("vault.emptyOffline")
                  }
                  title={t("vault.emptyTitle")}
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vault.asset")}</TableHead>
                    <TableHead>{t("vault.colQuantity")}</TableHead>
                    <TableHead>{t("vault.colValue")}</TableHead>
                    <TableHead>{t("vault.colUnlock")}</TableHead>
                    <TableHead>{t("vault.colStatus")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((position) => {
                    const eligible = isEligible(position.unlockAt);
                    const remaining = position.daysRemaining ?? daysUntil(position.unlockAt);
                    return (
                      <TableRow key={position.lockAddress}>
                        <TableCell>
                          <div>
                            <p className="font-semibold">{position.ticker ?? t("vault.asset")}</p>
                            <p className="text-xs text-muted">
                              {position.name ?? position.mint.slice(0, 8)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{formatNumber(position.quantity, locale)}</TableCell>
                        <TableCell className="font-mono">{formatCurrency(position.valueUsd, locale)}</TableCell>
                        <TableCell>
                          <div>
                            <p>{formatDate(position.unlockAt, locale, timeZone, t("common.notUpdated"))}</p>
                            <p className="text-xs text-muted">
                              {eligible
                                ? t("vault.eligibleNow")
                                : t("vault.daysLeft", { count: remaining })}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                              eligible ? "bg-green-100 text-green-900" : "bg-panel-subtle text-muted",
                            )}
                          >
                            {eligible ? t("vault.eligible") : t("vault.locked")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            disabled={!financialExecutionEnabled || !eligible}
                            onClick={() => openUnlockReview(position)}
                            size="sm"
                            variant="secondary"
                          >
                            {eligible ? t("vault.reviewUnlock") : t("vault.locked")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </div>

      <VaultReviewModal
        details={review}
        onClose={() => setReview(undefined)}
        open={Boolean(review)}
        programLive={programLive}
      />
    </div>
  );
}
