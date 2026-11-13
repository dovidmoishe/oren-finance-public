"use client";

import { EmptyState, formatCurrency, formatRelativeTime } from "@/components/ui";
import type { PortfolioActivityItem } from "@/types";
import { useI18n, type MessageKey } from "@/i18n/i18n";

const labels: Record<PortfolioActivityItem["type"], MessageKey> = {
  trade: "common.activityTrade",
  basket: "common.activityBasket",
  lock: "common.activityLock",
  unlock: "common.activityUnlock",
  transfer: "common.activityTransfer",
  unknown: "common.activityUnknown",
};

export function ActivityList({ items }: { items: PortfolioActivityItem[] }) {
  const { locale, t } = useI18n();
  if (!items.length) {
    return (
      <EmptyState
        description={t("common.noActivityDescription")}
        title={t("common.noActivityTitle")}
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div className="flex items-center justify-between gap-4 rounded-[18px] border border-border bg-background p-3" key={item.id}>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {t(labels[item.type])}
              {item.ticker ? <span className="text-muted"> · {item.ticker}</span> : null}
              {item.route ? <span className="text-muted"> · {item.route}</span> : null}
            </p>
            <p className="text-xs text-muted">{formatRelativeTime(item.occurredAt, locale, { justNow: t("common.justNow"), unknown: t("common.unknown") })}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm">{item.valueUsd ? formatCurrency(item.valueUsd, locale) : item.status ?? t("common.activitySeen")}</p>
            {item.signature ? <p className="text-xs text-muted">{item.signature.slice(0, 8)}...</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
