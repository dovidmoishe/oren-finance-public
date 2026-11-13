"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOrenAuth } from "@/components/auth/auth-context";
import {
  getStockResearch,
  recordResearchSourceOpen,
} from "@/services/research-service";
import type {
  CompanyCitationView,
  CompanyMetricView,
  CompanyPeriodView,
  CompanyResearchData,
  StockResearch,
} from "@/types";
import { MessageKeyError, useI18n, useShownMessage, shownFromUnknown, type MessageKey, type ShownMessage, type Translate } from "@/i18n/i18n";

export function StockResearchPanel({ assetId }: { assetId: string }) {
  const auth = useOrenAuth();
  const { locale, timeZone, t } = useI18n();
  const [loadedReport, setReport] = useState<StockResearch>();
  const [reportWallet, setReportWallet] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ShownMessage>();
  const requestId = useRef(0);
  const wallet = auth.address;
  const report =
    wallet && reportWallet === wallet && loadedReport?.assetId === assetId
      ? loadedReport
      : undefined;
  const bullishView = report?.opinions.data?.items.find(
    (item) =>
      item.stance === "BULLISH" && item.action?.toUpperCase() !== "EXIT",
  );
  const bearishView = report?.opinions.data?.items.find(
    (item) =>
      item.stance === "BEARISH" &&
      item.action?.toUpperCase() !== "EXIT" &&
      item.author.toLowerCase() !== bullishView?.author.toLowerCase(),
  );
  const errorText = useShownMessage(error);
  const getAccessToken = auth.getAccessToken;

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const current = ++requestId.current;
    setLoading(true);
    setError(undefined);
    try {
      const token = await getAccessToken();
      if (!token) throw new MessageKeyError("research.signInToLoad");
      const next = await getStockResearch(assetId, wallet, token);
      if (current !== requestId.current) return;
      setReport(next);
      setReportWallet(wallet);
    } catch (cause) {
      if (current === requestId.current)
        setError(shownFromUnknown(cause, "research.unavailable"));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [assetId, wallet, getAccessToken]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    const activeRequestId = requestId;
    return () => {
      clearTimeout(timer);
      activeRequestId.current++;
    };
  }, [refresh]);

  const recordSource = () => {
    if (!wallet) return;
    void getAccessToken()
      .then((token) =>
        token ? recordResearchSourceOpen(assetId, wallet, token) : undefined,
      )
      .catch(() => undefined);
  };

  return (
    <section
      aria-labelledby="stock-research-title"
      className="rounded-[20px] border border-border bg-panel p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="stock-research-title"
            className="font-display text-lg font-semibold"
          >
            {t("research.title")}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {t("research.subtitle")}
          </p>
        </div>
        <button
          className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-panel-subtle disabled:opacity-50"
          disabled={loading || !wallet}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? t("research.refreshing") : t("research.refresh")}
        </button>
      </div>
      {!wallet ? (
        <p className="mt-5 text-sm text-muted">
          {t("research.signedOut")}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {errorText}
        </p>
      ) : null}
      {report ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-border bg-panel-subtle p-4">
            <h3 className="text-sm font-semibold">{t("research.orenRead")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {report.analysis.data?.summary ??
                t("research.analysisUnavailable")}
            </p>
            {report.analysis.data ? (
              <p className="mt-3 text-xs text-muted">
                {t("research.scoreLine", {
                  score: Math.round(report.analysis.data.opportunityScore),
                  date: dateLabel(t, report.analysis.observedAt, locale, timeZone),
                })}
              </p>
            ) : null}
            {report.news.available &&
            report.news.data?.some(
              (item) =>
                item.url?.startsWith("https://") &&
                Number.isFinite(Date.parse(item.publishedAt)),
            ) ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-medium">{t("research.citedNews")}</p>
                <ul className="mt-2 space-y-2 text-xs">
                  {report.news.data
                    .filter(
                      (item) =>
                        item.url?.startsWith("https://") &&
                        Number.isFinite(Date.parse(item.publishedAt)),
                    )
                    .slice(0, 3)
                    .map((item) => (
                    <li key={item.url}>
                      <a
                        className="underline-offset-2 hover:underline"
                        href={item.url}
                        onClick={recordSource}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {item.headline}
                      </a>
                      <span className="ml-1 text-muted">
                        · {dateLabel(t, item.publishedAt, locale, timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.portfolio.available ? (
              <p className="mt-2 text-xs text-muted">
                {t("research.exposure", {
                  value: report.portfolio.data
                    ? t("research.exposurePercent", { percent: report.portfolio.data.allocationPercent.toFixed(1) })
                    : t("research.noPosition"),
                })}
              </p>
            ) : null}
          </article>
          <article className="rounded-2xl border border-border bg-panel-subtle p-4">
            <h3 className="text-sm font-semibold">{t("research.writerViews")}</h3>
            {!report.opinions.available ? (
              <p className="mt-2 text-sm text-muted">
                {report.opinions.reason === "not_enabled"
                  ? t("research.opinionsDisabled")
                  : t("research.opinionsFailed")}
              </p>
            ) : null}
            {report.opinions.data ? (
              <>
                <p className="mt-2 text-xs text-muted">
                  {t("research.opinionsMeta", {
                    writers: report.opinions.data.distinctAuthors,
                    mentions: report.opinions.data.mentionCount,
                    coverage: report.opinions.data.coverage,
                    date: dateLabel(t, report.opinions.observedAt, locale, timeZone),
                  })}
                </p>
                {report.opinions.data.window ? (
                  <p className="mt-1 text-xs text-muted">
                    {t("research.covered", {
                      from: dateLabel(t, report.opinions.data.window.from, locale, timeZone),
                      to: dateLabel(t, report.opinions.data.window.to, locale, timeZone),
                    })}
                  </p>
                ) : null}
                <div className="mt-3 space-y-3">
                  {report.opinions.data.items.slice(0, 4).map((item) => (
                    <div
                      className="border-t border-border pt-3"
                      key={`${item.author}-${item.url}`}
                    >
                      <a
                        className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
                        href={item.url}
                        onClick={recordSource}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {item.linkLabel ?? item.author}
                        {item.sourceLabel ? (
                          <span className="font-normal text-muted"> · {item.sourceLabel}</span>
                        ) : (
                          <span className="font-normal text-muted"> · {item.source}</span>
                        )}
                      </a>
                      <p className="mt-1 text-xs text-muted">
                        {item.stance ?? t("research.unstated")}
                        {item.action ? ` · ${item.action}` : ""} ·{" "}
                        {dateLabel(t, item.date, locale, timeZone)}
                      </p>
                      <p className="mt-1 text-sm leading-5">{item.summary}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </article>
          {report.company ? (
            <CompanyFilings
              company={report.company}
              onOpenSource={recordSource}
            />
          ) : null}
          <article className="rounded-2xl border border-border bg-panel-subtle p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold">{t("research.disagreeTitle")}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              {report.opinions.data?.disagreement
                ? t("research.disagree")
                : report.opinions.data?.coverage === "current"
                  ? t("research.noOpposing")
                  : t("research.limitedCoverage")}
            </p>
            {report.opinions.data?.disagreement &&
            bullishView &&
            bearishView ? (
              <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs leading-5">
                <p>
                  <a
                    className="font-medium hover:underline"
                    href={bullishView.url}
                    onClick={recordSource}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {bullishView.author}
                  </a>
                  : {bullishView.summary}
                </p>
                <p>
                  <a
                    className="font-medium hover:underline"
                    href={bearishView.url}
                    onClick={recordSource}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {bearishView.author}
                  </a>
                  : {bearishView.summary}
                </p>
              </div>
            ) : null}
          </article>
          {/* Thesis posting stays off the desk. saveStockThesis remains on the API for a later pass. */}
        </div>
      ) : loading ? (
        <p className="mt-5 text-sm text-muted">{t("research.loading")}</p>
      ) : null}
    </section>
  );
}

function dateLabel(t: Translate, value: string | undefined, locale: string, timeZone: string) {
  const missing = t("research.timeUnavailable");
  if (!value) return missing;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return missing;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : timeZone,
  }).format(date);
}

const FILING_LINK_CLASS =
  "font-medium text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
const SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/";
// The API appends this English line to every briefing; the panel shows the
// translated disclaimer once instead.
const COMPANY_DISCLAIMER =
  "Filing facts, not the Oren Score, not a recommendation.";

function CompanyFilings({
  company,
  onOpenSource,
}: {
  company: NonNullable<StockResearch["company"]>;
  onOpenSource: () => void;
}) {
  const { locale, timeZone, t } = useI18n();
  const data = company.data;
  const cards = data ? companyCards(t, data, locale, timeZone) : [];
  const filings = sourceFilings(t, data, locale, timeZone);
  return (
    <article className="rounded-2xl border border-border bg-panel-subtle p-4 lg:col-span-2">
      <h3 className="text-sm font-semibold">{t("research.filings")}</h3>
      <p className="mt-2 text-xs text-muted">{t("research.filingsNote")}</p>
      {company.reason ? (
        <p className="mt-2 text-sm text-muted">
          {t(companyReason(company.reason))}
        </p>
      ) : null}
      {cards.length ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {cards.map((card) => (
            <section
              className="rounded-xl border border-border bg-panel p-3"
              key={card.key}
            >
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {card.title}
              </h4>
              <p className="mt-1 text-sm font-semibold">{card.period}</p>
              <p className="text-[11px] text-muted">{card.range}</p>
              <dl className="mt-3 space-y-2">
                <MetricFact
                  label={t("research.metricRevenue")}
                  metric={card.revenue}
                  onOpenSource={onOpenSource}
                />
                <MetricFact
                  label={t("research.metricNetIncome")}
                  metric={card.netIncome}
                  onOpenSource={onOpenSource}
                />
                <MetricFact
                  label={t("research.metricMargin")}
                  metric={card.margin}
                  onOpenSource={onOpenSource}
                />
                <MetricFact
                  label={t("research.metricYoy")}
                  metric={card.yoy}
                  note={card.yoyNote}
                  onOpenSource={onOpenSource}
                />
              </dl>
            </section>
          ))}
        </div>
      ) : data?.briefing.length ? (
        <div className="mt-3 space-y-2">
          {data.briefing
            .filter((line) => line !== COMPANY_DISCLAIMER)
            .map((line) => (
              <p className="text-sm leading-6 text-muted" key={line}>
                <BriefingText line={line} onOpenSource={onOpenSource} />
              </p>
            ))}
        </div>
      ) : null}
      {filings.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-xs font-semibold">
            {t("research.sourceFilings")}
          </h4>
          <ul className="mt-2 divide-y divide-border">
            {filings.map((filing) => (
              <li
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                key={filing.key}
              >
                <span className="inline-flex rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
                  {filing.form}
                </span>
                <span className="text-xs text-muted">{filing.period}</span>
                <span className="text-xs text-muted">
                  {t("research.filedOn", { date: filing.filed })}
                </span>
                <a
                  className={`ml-auto text-xs ${FILING_LINK_CLASS}`}
                  href={filing.url}
                  onClick={onOpenSource}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t("research.viewOnSec")}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {company.fetchedAt ? (
        <p className="mt-2 text-xs text-muted">
          {t("research.fetched", { date: dateLabel(t, company.fetchedAt, locale, timeZone) })}
        </p>
      ) : null}
    </article>
  );
}

function BriefingText({
  line,
  onOpenSource,
}: {
  line: string;
  onOpenSource: () => void;
}) {
  return briefingParts(line).map((part, index) =>
    part.kind === "link" ? (
      <a
        className={FILING_LINK_CLASS}
        href={part.url}
        key={`${part.url}-${index}`}
        onClick={onOpenSource}
        rel="noopener noreferrer"
        target="_blank"
      >
        {part.label}
      </a>
    ) : (
      <span key={`${index}-${part.text}`}>{part.text}</span>
    ),
  );
}

function briefingParts(
  line: string,
): Array<
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; url: string }
> {
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  const parts: Array<
    | { kind: "text"; text: string }
    | { kind: "link"; label: string; url: string }
  > = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ kind: "text", text: line.slice(cursor, index) });
    }
    const label = match[1] ?? "";
    const url = match[2] ?? "";
    if (url.startsWith(SEC_ARCHIVE)) {
      parts.push({ kind: "link", label, url });
    } else if (label) {
      parts.push({ kind: "text", text: label });
    }
    cursor = index + match[0].length;
  }
  if (cursor < line.length) {
    parts.push({ kind: "text", text: line.slice(cursor) });
  }
  return parts;
}

function MetricFact({
  label,
  metric,
  note,
  onOpenSource,
}: {
  label: string;
  metric?: CompanyMetricView;
  note?: string;
  onOpenSource: () => void;
}) {
  const { locale, timeZone, t } = useI18n();
  const sources = metricSources(metric);
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-right">
        <p className="text-xs font-medium tabular-nums">
          {metric?.available && metric.display
            ? metric.display
            : t("research.metricUnavailable")}
          {metric?.derived && metric.available ? (
            <span className="ml-1 font-normal text-muted">
              {t("research.metricDerived")}
            </span>
          ) : null}
        </p>
        {note ? <p className="text-[11px] text-muted">{note}</p> : null}
        {sources.map((source) => (
          <a
            className={`mt-0.5 block text-[11px] ${FILING_LINK_CLASS}`}
            href={source.sourceUrl}
            key={source.sourceUrl}
            onClick={onOpenSource}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("research.citationFiled", {
              form: source.form,
              date: dateLabel(t, source.filed, locale, timeZone),
            })}
          </a>
        ))}
      </dd>
    </div>
  );
}

function companyCards(
  t: Translate,
  data: CompanyResearchData,
  locale: string,
  timeZone: string,
): Array<{
  key: string;
  title: string;
  period: string;
  range: string;
  revenue?: CompanyMetricView;
  netIncome?: CompanyMetricView;
  margin?: CompanyMetricView;
  yoy?: CompanyMetricView;
  yoyNote?: string;
}> {
  const cards = [];
  if (data.latestQuarter) {
    const period = data.latestQuarter;
    cards.push({
      key: "quarter",
      title: t("research.latestQuarter"),
      period: fiscalLabel(period),
      range: rangeLabel(t, period.start, period.end, locale, timeZone),
      revenue: period.revenue,
      netIncome: period.netIncome,
      margin: period.operatingMargin,
      yoy: period.revenueGrowth,
      yoyNote: period.fiscalQuarter
        ? t("research.vsQuarter", {
            year: period.fiscalYear - 1,
            quarter: period.fiscalQuarter,
          })
        : undefined,
    });
  }
  if (data.ttm) {
    cards.push({
      key: "ttm",
      title: t("research.ttm"),
      period: t("research.ttmPeriod"),
      range:
        data.ttm.start && data.ttm.end
          ? rangeLabel(t, data.ttm.start, data.ttm.end, locale, timeZone)
          : t("research.periodNotStated"),
      revenue: data.ttm.revenue,
      netIncome: data.ttm.netIncome,
      margin: data.ttm.operatingMargin,
      yoy: data.ttm.revenueGrowth,
      yoyNote: t("research.vsTtm"),
    });
  }
  if (data.latestAnnual) {
    const period = data.latestAnnual;
    cards.push({
      key: "year",
      title: t("research.fullYear"),
      period: fiscalLabel(period),
      range: rangeLabel(t, period.start, period.end, locale, timeZone),
      revenue: period.revenue,
      netIncome: period.netIncome,
      margin: period.operatingMargin,
      yoy: period.revenueGrowth,
      yoyNote: t("research.vsYear", { year: period.fiscalYear - 1 }),
    });
  }
  return cards;
}

function sourceFilings(t: Translate, data: CompanyResearchData | undefined, locale: string, timeZone: string) {
  const rows = (data?.filings ?? [])
    .filter((filing) => filing.sourceUrl.startsWith(SEC_ARCHIVE))
    .map((filing) => ({
      key: filing.accession,
      form: filing.form,
      period: filing.reportDate
        ? t("research.periodEnded", { date: dateLabel(t, filing.reportDate, locale, timeZone) })
        : t("research.periodNotStated"),
      filed: dateLabel(t, filing.filed, locale, timeZone),
      filedSort: filing.filed,
      url: filing.sourceUrl,
    }));
  if (rows.length) {
    return rows.sort(
      (a, b) =>
        b.filedSort.localeCompare(a.filedSort) || b.key.localeCompare(a.key),
    );
  }
  return (data?.links ?? [])
    .filter((link) => link.url.startsWith(SEC_ARCHIVE))
    .map((link) => ({
      key: link.url,
      form: link.label.split(" ")[0] || t("research.filingForm"),
      period: t("research.periodNotStated"),
      filed: t("research.dateUnavailable"),
      filedSort: "",
      url: link.url,
    }));
}

function metricSources(metric?: CompanyMetricView): CompanyCitationView[] {
  const items = [metric?.citation, ...(metric?.inputCitations ?? [])].filter(
    (item): item is CompanyCitationView =>
      Boolean(item?.sourceUrl?.startsWith(SEC_ARCHIVE)),
  );
  const byUrl = new Map<string, CompanyCitationView>();
  for (const item of items) {
    const existing = byUrl.get(item.sourceUrl);
    if (!existing || item.filed > existing.filed)
      byUrl.set(item.sourceUrl, item);
  }
  return [...byUrl.values()].sort(
    (a, b) => b.filed.localeCompare(a.filed) || a.form.localeCompare(b.form),
  );
}

function fiscalLabel(period: CompanyPeriodView) {
  return period.fiscalQuarter
    ? `FY${period.fiscalYear} Q${period.fiscalQuarter}`
    : `FY${period.fiscalYear}`;
}

function rangeLabel(t: Translate, start: string | undefined, end: string | undefined, locale: string, timeZone: string) {
  if (!start || !end) return t("research.periodNotStated");
  return t("research.range", {
    from: dateLabel(t, start, locale, timeZone),
    to: dateLabel(t, end, locale, timeZone),
  });
}

const companyReasonKeys: Record<string, MessageKey> = {
  not_mapped: "research.reasonNotMapped",
  fund_no_statements: "research.reasonFund",
  no_coverage: "research.reasonNoCoverage",
  mint_mismatch: "research.reasonMintMismatch",
  identity_mismatch: "research.reasonIdentityMismatch",
  ambiguous_identity: "research.reasonAmbiguous",
  timeout: "research.reasonTimeout",
  rate_limited: "research.reasonRateLimited",
  provider_unavailable: "research.reasonProviderUnavailable",
  stale: "research.reasonStale",
  sec_not_configured: "research.reasonNotConfigured",
  sec_preview_disabled: "research.reasonPreview",
  sec_worker_unavailable: "research.reasonWorker",
  not_licensed: "research.reasonNotLicensed",
};

function companyReason(reason: string): MessageKey {
  return companyReasonKeys[reason] ?? "research.reasonDefault";
}
