"use client";

import { useEffect } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import { AppShell } from "@/components/shell";
import { Button, EmptyState } from "@/components/ui";
import { usePortfolioStore, useWalletStore } from "@/store";
import { ActivityList } from "./activity-list";
import { useT } from "@/i18n/i18n";

export function ActivityTimeline() {
  const auth = useOrenAuth();
  const t = useT();
  const wallet = useWalletStore((state) => state.address);
  const connected = useWalletStore((state) => state.connected);
  const activity = usePortfolioStore((state) => state.activity);
  const error = usePortfolioStore((state) => state.error);
  const loadActivity = usePortfolioStore((state) => state.loadActivity);

  useEffect(() => {
    if (!wallet || !connected) return;
    void loadActivity(wallet);
  }, [connected, loadActivity, wallet]);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl pb-20">
        <p className="text-sm text-muted">{t("common.historyEyebrow")}</p>
        <h1 className="mt-1 font-display text-4xl font-semibold tracking-normal">{t("common.activityTitle")}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
          {t("common.activityIntro")}
        </p>
        <div className="mt-6">
          {!connected ? (
            <EmptyState
              action={auth.ready && !auth.authenticated ? <Button onClick={auth.open}>{t("common.signIn")}</Button> : undefined}
              description={auth.authenticated ? t("common.activityPreparing") : t("common.activitySignedOut")}
              title={auth.authenticated ? t("common.preparingWallet") : t("common.activitySignInTitle")}
            />
          ) : (
            <>
              {error ? <p className="mb-3 text-sm text-negative">{error}</p> : null}
              <ActivityList items={activity} />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
