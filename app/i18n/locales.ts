// Shared locale list. Imported by server and client code, so no hooks or headers.

export const LOCALES = [
  { code: "en", name: "English" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
  { code: "fr", name: "Français" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "uk", name: "Українська" },
  { code: "de", name: "Deutsch" },
  { code: "pt-BR", name: "Português (Brasil)" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

/** next-intl's conventional name, read by the server on each request. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Browser zone for date formatting. The page refreshes once after it is saved. */
export const TIME_ZONE_COOKIE = "NEXT_TIMEZONE";

/** Previous client-only preference. Copied into the cookie once. */
export const LEGACY_LOCALE_STORAGE_KEY = "oren-locale";

export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

const CODES = new Set<string>(LOCALES.map((locale) => locale.code));

/** Reads one cookie from a `document.cookie` string, including `;` without a space. */
export function cookieValue(cookie: string, name: string): string | undefined {
  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const item = part.trim();
    if (!item.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(item.slice(prefix.length));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && CODES.has(value);
}

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) return false;
  try {
    Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Open Graph locale tags use underscores. English has no region in our catalog. */
export function openGraphLocale(locale: Locale): string {
  if (locale === "en") return "en_US";
  return locale.replace("-", "_");
}

/** Routes whose layout reads the locale cookie. Everything else stays static English. */
export function isPersonalizedPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/")
    || pathname === "/connect" || pathname.startsWith("/connect/")
    || pathname === "/settings" || pathname.startsWith("/settings/");
}

/**
 * A returning browser that already stored Oren state, but never a locale.
 * The old switcher deleted `oren-locale` when the choice was English.
 */
export function hasOtherOrenStorage(keys: Iterable<string>): boolean {
  for (const key of keys) {
    if (key === LEGACY_LOCALE_STORAGE_KEY) continue;
    if (key.startsWith("oren-") || key.startsWith("oren.")) return true;
  }
  return false;
}

function languageRanges(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params.find((param) => param.trim().toLowerCase().startsWith("q="));
      const q = quality ? Number(quality.split("=")[1]) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((item) => item.tag && item.tag !== "*" && item.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((item) => item.tag);
}

function matchRange(range: string): Locale | undefined {
  if (isLocale(range)) return range;
  const folded = range.toLowerCase();
  const exact = LOCALES.find((locale) => locale.code.toLowerCase() === folded);
  if (exact) return exact.code;
  if (folded === "zh" || folded.startsWith("zh-hans") || folded === "zh-cn" || folded.startsWith("zh-hans-")) return "zh-CN";
  if (folded.startsWith("zh-hant") || folded === "zh-tw" || folded === "zh-hk" || folded === "zh-mo") return "zh-TW";
  // The catalog has Brazilian Portuguese only.
  if (folded === "pt" || folded.startsWith("pt-")) return "pt-BR";
  // Former Indonesian tag.
  if (folded === "in" || folded.startsWith("in-")) return "id";
  const primary = folded.split("-")[0];
  return LOCALES.find((locale) => locale.code.toLowerCase() === primary)?.code;
}

/**
 * Explicit cookie, then the best Accept-Language match, then English.
 * An invalid cookie does not block negotiation.
 */
export function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (acceptLanguage) {
    for (const range of languageRanges(acceptLanguage)) {
      const match = matchRange(range);
      if (match) return match;
    }
  }
  return DEFAULT_LOCALE;
}
