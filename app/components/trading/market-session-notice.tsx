"use client";

import { Toast } from "@/components/ui";
import type { MarketSession } from "@/types";
import { useT } from "@/i18n/i18n";

export function MarketSessionNotice({
  session,
  variant = "toast",
  className,
}: {
  session?: MarketSession | null;
  variant?: "toast" | "note";
  className?: string;
}) {
  const t = useT();
  if (!session || session.regular || !session.summary) return null;
  if (variant === "note") {
    return (
      <p className="mt-3 rounded-[13px] bg-white/60 px-3 py-2 text-[11px] leading-4 text-muted">
        <span className="font-semibold text-foreground">{t("review.marketHoursPrefix")}</span>
        {session.summary}
      </p>
    );
  }
  return (
    <div className={className}>
      <Toast title={t("review.marketHours")} description={session.summary} tone="info" />
    </div>
  );
}
