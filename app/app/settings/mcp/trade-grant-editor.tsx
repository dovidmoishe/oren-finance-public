"use client";

import { useId, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, InformationCircleIcon, Shield01Icon } from "@hugeicons/core-free-icons";
import type { GrantSettings } from "@/services/mcp-grant-authorization";
import { grantDurationOptions, parseGrantSettings, type GrantDraft, type GrantSpendLimits } from "@/services/mcp-grant-settings";
import { useI18n } from "@/i18n/i18n";

export function TradeGrantEditor({ sellAvailable, maxDurationHours, untilRevoked, spendLimits, busy, signerConfigured, onReview }: {
  sellAvailable: boolean;
  maxDurationHours: number;
  untilRevoked: boolean;
  spendLimits?: GrantSpendLimits;
  busy: boolean;
  signerConfigured: boolean;
  onReview: (settings: GrantSettings) => Promise<void>;
}) {
  const id = useId();
  const { locale, t } = useI18n();
  const durations = grantDurationOptions(maxDurationHours);
  const defaultDuration = durations.filter(hours => hours <= 24).at(-1) ?? 1;
  const [draft, setDraft] = useState<GrantDraft>({ perTradeUsd: "25", dailyUsd: "50", slippagePercent: "0.5", durationHours: String(defaultDuration) });
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string>();
  function update(field: keyof GrantDraft, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
    setAcknowledged(false);
    setError(undefined);
  }
  return (
    <form className="[margin-top:28px]" onSubmit={event => {
      event.preventDefault();
      if (busy || !acknowledged || !signerConfigured) return;
      try { void onReview(parseGrantSettings(draft, sellAvailable, maxDurationHours, untilRevoked, spendLimits)); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("grant.checkLimits")); }
    }}>
      <fieldset disabled={busy} className="trade-grant-fields">
        <legend className="absolute [width:1px] [height:1px] [padding:0] overflow-hidden [clip-path:inset(50%)] whitespace-nowrap">{t("grant.setLimits")}</legend>
        <div className="trade-grant-permission">
          <div>
            <span className="trade-grant-label">{t("grant.whatAgentCanDo")}</span>
            <p>{sellAvailable ? t("grant.canBuySell") : t("grant.canBuy")}</p>
          </div>
          <span className="trade-grant-badge">{sellAvailable ? t("grant.buyAndSell") : t("grant.buyOnly")}</span>
        </div>
        {!sellAvailable && <p className="trade-grant-caption">{t("grant.sellUnavailable")}</p>}
        <div className="trade-grant-grid">
          <label className="trade-grant-field">
            <span>{t("grant.perTrade")}</span>
            <span className="trade-grant-input-wrap"><span aria-hidden="true">$</span><input aria-label={t("grant.perTradeAria")} aria-describedby={`${id}-trade`} type="number" inputMode="decimal" min="0.01" max={spendLimits?.maxPerTradeUsd ?? 25} step="0.01" required value={draft.perTradeUsd} onChange={event => update("perTradeUsd", event.target.value)} /><span>USD</span></span>
            <small id={`${id}-trade`}>{t("grant.perTradeHint", { max: new Intl.NumberFormat(locale).format(spendLimits?.maxPerTradeUsd ?? 25) })}</small>
          </label>
          <label className="trade-grant-field">
            <span>{t("grant.perDay")}</span>
            <span className="trade-grant-input-wrap"><span aria-hidden="true">$</span><input aria-label={t("grant.perDayAria")} aria-describedby={`${id}-daily`} type="number" inputMode="decimal" min="0.01" max={spendLimits?.maxDailyUsd ?? 50} step="0.01" required value={draft.dailyUsd} onChange={event => update("dailyUsd", event.target.value)} /><span>USD</span></span>
            <small id={`${id}-daily`}>{t("grant.perDayHint", { max: new Intl.NumberFormat(locale).format(spendLimits?.maxDailyUsd ?? 50) })}</small>
          </label>
          <label className="trade-grant-field">
            <span>{t("grant.tolerance")}</span>
            <span className="trade-grant-input-wrap"><input aria-label={t("grant.toleranceAria")} aria-describedby={`${id}-slippage`} type="number" inputMode="decimal" min="0.01" max="0.5" step="0.01" required value={draft.slippagePercent} onChange={event => update("slippagePercent", event.target.value)} /><span>%</span></span>
            <small id={`${id}-slippage`}>{t("grant.toleranceHint")}</small>
          </label>
          {untilRevoked ? <p className="trade-grant-caption">{t("grant.untilRevoked")}</p> : <label className="trade-grant-field">
            <span>{t("grant.expiresAfter")}</span>
            <select value={draft.durationHours} onChange={event => update("durationHours", event.target.value)}>
              {durations.map(hours => (
                <option key={hours} value={String(hours)}>
                  {hours <= 24 ? t("grant.hours", { count: hours }) : new Intl.NumberFormat(locale, { style: "unit", unit: "day", unitDisplay: "long" }).format(hours / 24)}
                </option>
              ))}
            </select>
            <small>{t("grant.stopsAutomatically")}</small>
          </label>}
        </div>
        <div className="trade-grant-summary">
          <HugeiconsIcon icon={Shield01Icon} size={20} strokeWidth={1.6} aria-hidden="true" />
          <div><strong>{t("grant.summaryTitle")}</strong><p>{t("grant.summaryBody")}</p></div>
        </div>
        <p className="trade-grant-caption">{t("grant.noSigners")}</p>
        <details className="trade-grant-details">
          <summary>{t("grant.howItWorks")}</summary>
          <p>{t("grant.howItWorks1")}</p>
          <p>{t("grant.howItWorks2")}</p>
        </details>
        <label className="trade-grant-checkbox"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>{sellAvailable ? t("grant.ackBuySell") : t("grant.ackBuy")}</span></label>
      </fieldset>
      {!signerConfigured && <p className="trade-grant-warning" role="alert"><HugeiconsIcon icon={InformationCircleIcon} size={18} aria-hidden="true" /><span>{t("grant.setupUnavailable")}</span></p>}
      {error && <p className="trade-grant-error" role="alert">{error}</p>}
      <div className="trade-grant-footer">
        <span>{t("grant.reviewNext")}</span>
        <button className="trade-grant-primary" type="submit" disabled={busy || !acknowledged || !signerConfigured}>{busy ? t("grant.preparing") : t("grant.review")}<HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></button>
      </div>
    </form>
  );
}
