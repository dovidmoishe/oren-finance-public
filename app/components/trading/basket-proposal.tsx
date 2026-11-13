"use client";

import { Briefcase01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { BasketResponse } from "@/types";
import { StockLogo } from "@/components/stock/stock-logo";
import { Button, formatCurrency, formatNumber } from "@/components/ui";
import { MarketSessionNotice } from "./market-session-notice";
import { useI18n } from "@/i18n/i18n";

export function BasketProposal({ basket, onReview }: { basket: BasketResponse; onReview: (basket: BasketResponse) => void }) {
  const { locale, t } = useI18n();
  return <section className="overflow-hidden rounded-[20px] border border-border bg-panel">
    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
      <span className="flex items-center gap-2 text-xs font-medium"><HugeiconsIcon icon={Briefcase01Icon} size={15} strokeWidth={1.8} />{t("basket.stockMix")}</span>
      <span className="text-[11px] text-muted">{t("basket.stockCount", { count: basket.allocations.length })}</span>
    </header>
    <div className="p-5">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div><p className="text-[11px] text-muted">{t("basket.totalAmount")}</p><p className="mt-1 font-display text-3xl font-medium tracking-[-0.04em]">{formatCurrency(basket.totalAmountUsd, locale)}</p></div>
        {basket.riskLabel && <span className="rounded-full bg-panel-subtle px-2.5 py-1 text-[10px] text-muted">{basket.riskLabel}</span>}
      </div>
      <div className="space-y-4">
        {basket.allocations.map((allocation) => <div key={allocation.assetId}>
          <div className="flex items-center gap-2.5">
            <StockLogo ticker={allocation.ticker} />
            <div className="min-w-0 flex-1"><p className="text-xs font-medium">{allocation.name ?? allocation.ticker}</p><p className="mt-0.5 text-[10px] text-muted">{allocation.ticker}</p></div>
            <div className="text-right"><p className="text-xs font-medium tabular-nums">{formatCurrency(allocation.amountUsd, locale)}</p><p className="mt-0.5 text-[10px] tabular-nums text-muted">{formatNumber(allocation.weightPercent, locale, 0)}%</p></div>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-panel-subtle"><div className="h-full rounded-full bg-[#c9bde0]" style={{ width: `${Math.min(100, Math.max(0, allocation.weightPercent))}%` }} /></div>
        </div>)}
      </div>
      {basket.thesis && <p className="mt-5 text-xs leading-5 text-muted">{basket.thesis}</p>}
      <MarketSessionNotice className="mt-5" session={basket.marketSession} />
      <Button variant="primary" className="mt-5 h-10 w-full rounded-[12px]" onClick={() => onReview(basket)}>{t("basket.reviewMix")} <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={1.8} /></Button>
    </div>
  </section>;
}
