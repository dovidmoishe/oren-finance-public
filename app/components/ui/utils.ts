export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function amount(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** USD amount written with the active language's grouping and decimal marks. */
export function formatCurrency(value: number | undefined, locale: string, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(amount(value));
}

/** Compact USD, still using the active language's grouping. Invalid amounts render as zero. */
export function formatCompactCurrency(value: number | undefined, locale: string) {
  const finite = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    notation: "compact",
  }).format(finite);
}

export function formatNumber(value: number | undefined, locale: string, maximumFractionDigits = 4) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(amount(value));
}

export function formatPercent(value: number | undefined, locale: string, showSign = true) {
  const finite = typeof value === "number" && Number.isFinite(value);
  const body = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(finite ? Math.abs(value) : 0);
  if (!finite) return `${body}%`;
  const sign = value < 0 ? "-" : showSign ? "+" : "";
  return `${sign}${body}%`;
}

/**
 * Calendar dates (`YYYY-MM-DD`) stay on that UTC day. Timestamps use `timeZone`,
 * which the request config shares between server and client.
 */
export function formatDate(value: string | undefined, locale: string, timeZone = "UTC", missing = "Not updated") {
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

export function formatDateTime(value: string | number | Date | undefined, locale: string, timeZone = "UTC", missing = "Unknown") {
  if (value == null || value === "") return missing;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return missing;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
}

export function formatRelativeTime(
  value: string | undefined,
  locale: string,
  labels: { justNow?: string; unknown?: string } = {},
) {
  const unknown = labels.unknown ?? "Unknown";
  if (!value) return unknown;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unknown;
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return labels.justNow ?? "just now";
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (absMs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return labels.justNow ?? "just now";
}

export function formatMonth(month: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** Sunday-first short weekday names. 2023-01-01 was a Sunday. */
export function weekdayLabels(locale: string) {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(Date.UTC(2023, 0, 1 + day))));
}
