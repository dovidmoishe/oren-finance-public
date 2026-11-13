"use client";

import { Add01Icon, MinusSignIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { TechnicalBriefPanel } from "@/components/stock/technical-brief-panel";
import { formatCurrency, formatNumber, formatPercent, formatRelativeTime } from "@/components/ui/utils";
import type { NewsItem, StockAnalysis, StockDetail } from "@/types";
import { useI18n, type MessageKey, type MessageValues, type Translate } from "@/i18n/i18n";

const trendLabels: Record<"uptrend" | "downtrend" | "range", MessageKey> = { uptrend: "stock.uptrend", downtrend: "stock.downtrend", range: "stock.range" };

function percent(t: Translate, locale: string, value?: number, signed = true) {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value, locale, signed) : t("stock.unavailable");
}

function metric(t: Translate, locale: string, value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? formatNumber(value, locale, 2) : t("stock.unavailable");
}

const trendKeys = {
  uptrend: { none: "stock.trendUp", up: "stock.trendUpMomentum", down: "stock.trendUpMomentumDown" },
  downtrend: { none: "stock.trendDown", up: "stock.trendDownMomentumUp", down: "stock.trendDownMomentum" },
  range: { none: "stock.trendRange", up: "stock.trendRangeMomentumUp", down: "stock.trendRangeMomentumDown" },
} as const satisfies Record<"uptrend" | "downtrend" | "range", Record<"none" | "up" | "down", MessageKey>>;

export function StockMarketOutlook({ stock, analysis, news }: {
  stock: StockDetail;
  analysis?: StockAnalysis;
  news: NewsItem[];
}) {
  const { locale, t } = useI18n();
  const brief = analysis?.technicalBrief;
  const trend = brief ? t(trendLabels[brief.regime]) : t("stock.unavailable");
  const momentum = analysis?.signals.momentum7d;
  const hasMomentum = typeof momentum === "number" && Number.isFinite(momentum);
  const momentumValues: MessageValues = hasMomentum ? { ticker: stock.ticker, percent: formatPercent(Math.abs(momentum), locale, false) } : { ticker: stock.ticker };
  const takeaway = brief
    ? t(trendKeys[brief.regime][hasMomentum ? (momentum >= 0 ? "up" : "down") : "none"], momentumValues)
    : hasMomentum
      ? t(momentum >= 0 ? "stock.momentumUp" : "stock.momentumDown", momentumValues)
      : t("stock.noOutlook");
  const risk = brief?.risks[0] ?? (typeof analysis?.signals.volatility30d === "number"
    ? t("stock.volatilityRisk", { percent: percent(t, locale, analysis.signals.volatility30d, false) })
    : undefined);
  const score = analysis?.opportunityScore;

  return (
    <section aria-labelledby="market-outlook-title" className="rounded-[20px] border border-border bg-panel px-5 sm:px-6">
      <div className="py-5 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <h2 className="font-display text-base font-semibold" id="market-outlook-title">{t("stock.outlookTitle")}</h2>
          {analysis ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              {typeof score === "number" && Number.isFinite(score) ? (
                <span>{t("stock.opportunity")} <span className="ml-1 font-mono font-medium text-foreground">{Math.round(Math.min(100, Math.max(0, score)))}<span className="font-normal text-muted"> / 100</span></span></span>
              ) : null}
              {analysis.riskLabel ? <span className="capitalize">{t("stock.riskLabel", { label: analysis.riskLabel })}</span> : null}
            </div>
          ) : null}
        </div>

        {analysis ? (
          <>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{takeaway}</p>
            <dl className="mt-5 grid grid-cols-3 gap-3 sm:max-w-xl sm:gap-8">
              {[
                [t("stock.trend"), trend],
                [t("stock.momentum7d"), percent(t, locale, momentum)],
                [t("stock.volatility30d"), percent(t, locale, analysis.signals.volatility30d, false)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1.5 text-sm font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {risk ? <p className="mt-5 max-w-2xl text-xs leading-5 text-muted"><span className="font-medium text-foreground">{t("stock.watchFor")}</span>{risk}</p> : null}
          </>
        ) : <p className="mt-3 text-sm text-muted">{t("stock.analysisUnavailable")}</p>}
      </div>

      {analysis ? (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-xs font-medium focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
            <span><span className="group-open:hidden">{t("stock.viewDetails")}</span><span className="hidden group-open:inline">{t("stock.hideDetails")}</span></span>
            <span aria-hidden className="text-base font-normal text-muted"><span className="group-open:hidden"><HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span><span className="hidden group-open:inline"><HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={1.5} color="currentColor" aria-hidden="true" focusable="false" className="inline-block shrink-0 align-middle" /></span></span>
          </summary>
          <div className="space-y-5 pb-5">
            {analysis.summary ? <p className="max-w-3xl text-sm leading-6 text-muted">{analysis.summary}</p> : null}
            {brief ? <TechnicalBriefPanel brief={brief} /> : null}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs sm:grid-cols-3">
              {[
                [t("stock.momentum30d"), percent(t, locale, analysis.signals.momentum30d)],
                ...(!brief ? [[t("stock.rsi14"), metric(t, locale, analysis.signals.rsi14)]] : []),
                [t("stock.volumeTrend"), percent(t, locale, analysis.signals.volumeTrend)],
                [t("stock.liquidity"), typeof stock.liquidityUsd === "number" ? formatCurrency(stock.liquidityUsd, locale, 0) : t("stock.unavailable")],
                [t("stock.liquidityScore"), typeof analysis.signals.liquidityScore === "number" ? `${metric(t, locale, analysis.signals.liquidityScore)} / 100` : t("stock.unavailable")],
                [t("stock.sma20"), typeof analysis.signals.sma20 === "number" ? formatCurrency(analysis.signals.sma20, locale) : t("stock.unavailable")],
                [t("stock.sma50"), typeof analysis.signals.sma50 === "number" ? formatCurrency(analysis.signals.sma50, locale) : t("stock.unavailable")],
              ].map(([label, value]) => (
                <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 font-mono">{value}</dd></div>
              ))}
            </dl>
            {analysis.highlights.length ? <ul className="list-inside list-disc space-y-1 text-xs leading-5 text-muted">{analysis.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}
            <p className="text-xs leading-5 text-muted">{t("stock.basedOn", { time: formatRelativeTime(analysis.analyzedAt, locale, { justNow: t("common.justNow"), unknown: t("common.unknown") }) })}</p>
          </div>
        </details>
      ) : null}

      <div className="border-t border-border py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="text-xs font-medium">{t("stock.latestNews")}</h3>
          {!news.length ? <p className="text-xs text-muted">{t("stock.noNews")}</p> : null}
        </div>
        {news.length ? (
          <div className="mt-3 divide-y divide-border">
            {news.slice(0, 3).map((item) => (
              <article className="py-3 first:pt-0 last:pb-0" key={item.id}>
                <p className="mb-1 text-xs text-muted">{item.source ?? t("stock.marketNews")} · {formatRelativeTime(item.publishedAt, locale, { justNow: t("common.justNow"), unknown: t("common.unknown") })}</p>
                <h4 className="text-sm font-medium leading-5">{item.url ? <a className="hover:underline focus-visible:underline" href={item.url} rel="noreferrer" target="_blank">{item.headline}</a> : item.headline}</h4>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
