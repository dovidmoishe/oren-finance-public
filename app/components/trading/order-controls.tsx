"use client";

import type { TradeSide } from "@/types";
import { useT } from "@/i18n/i18n";

export function OrderControls({ side, onSideChange }: {
  side: TradeSide;
  onSideChange: (side: TradeSide) => void;
}) {
  const t = useT();
  return <div className="mb-2 flex items-center justify-between gap-4">
    <div aria-label={t("review.direction")} className="inline-flex min-w-0 flex-1 rounded-2xl bg-panel-subtle p-1 text-sm font-semibold" role="group">
      {(["buy", "sell"] as const).map((value) => <button
        aria-pressed={side === value}
        className={`h-8 min-w-0 flex-1 rounded-xl px-3 transition-colors ${side === value ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}
        key={value} onClick={() => onSideChange(value)} type="button"
      >{value === "buy" ? t("review.buy") : t("review.sell")}</button>)}
    </div>
  </div>;
}

export function LimitOrderToggle({ limit, limitFieldsId, onLimitChange }: {
  limit: boolean;
  limitFieldsId: string;
  onLimitChange: (limit: boolean) => void;
}) {
  const t = useT();
  return <label className="mt-2 mb-1 flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
      <span>{t("review.limitOrder")}</span>
      <input aria-controls={limitFieldsId} checked={limit} className="peer sr-only" onChange={(event) => onLimitChange(event.target.checked)} role="switch" type="checkbox" />
      <span
        aria-hidden
        className="inline-flex h-[24px] w-[42px] rounded-full bg-border-strong p-[3px] transition-[background-color] duration-150 ease-[ease] peer-checked:bg-foreground peer-checked:[&>span]:translate-x-[18px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-foreground motion-reduce:transition-none"
      >
        <span className="size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/.15)] transition-[translate] duration-[350ms] ease-[cubic-bezier(0.34,1.35,0.64,1)] motion-reduce:transition-none" />
      </span>
    </label>;
}
