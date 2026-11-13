"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLocale } from "next-intl";
import {
  DEFAULT_LOCALE,
  LEGACY_LOCALE_STORAGE_KEY,
  LOCALE_COOKIE,
  LOCALE_MAX_AGE,
  TIME_ZONE_COOKIE,
  cookieValue,
  hasOtherOrenStorage,
  isLocale,
  isPersonalizedPath,
  isTimeZone,
  type Locale,
} from "./locales";

/** Locale the switcher asked for, so a slower refresh cannot leave the previous language. */
let pendingLocale: Locale | null = null;
let pendingAttempts = 0;
let bootstrapped = false;

function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${LOCALE_MAX_AGE}; SameSite=Lax${secure}`;
}

function readCookie(name: string) {
  return cookieValue(document.cookie, name);
}

/** Saves an explicit choice, including English, so Accept-Language cannot override it. */
export function rememberLocale(locale: Locale) {
  pendingLocale = locale;
  pendingAttempts = 0;
  writeCookie(LOCALE_COOKIE, locale);
  try {
    localStorage.setItem(LEGACY_LOCALE_STORAGE_KEY, locale);
  } catch {
    // The cookie still selects the language when storage is blocked.
  }
}

function storageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * Copies a saved `oren-locale` into the cookie once, pins English for a
 * returning browser that never stored a locale, remembers the time zone,
 * keeps `<html lang>` current, and follows a language change from another tab.
 */
export function LocaleSync({ force = false }: { force?: boolean }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const enabled = force || !isPersonalizedPath(pathname);

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.lang = locale;
  }, [enabled, locale]);

  useEffect(() => {
    if (!enabled) return;
    if (!pendingLocale) return;
    if (pendingLocale === locale) {
      pendingAttempts = 0;
      return;
    }
    // A refresh that started before the latest click can still arrive. Retry
    // twice, then stop so a rejected cookie cannot refresh forever.
    if (pendingAttempts >= 2) return;
    pendingAttempts += 1;
    writeCookie(LOCALE_COOKIE, pendingLocale);
    router.refresh();
  }, [enabled, locale, router]);

  useEffect(() => {
    if (!enabled || bootstrapped) return;
    bootstrapped = true;
    let refresh = false;
    try {
      const saved = localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY);
      const cookie = readCookie(LOCALE_COOKIE);
      // A tap already chose a language. Do not pin English over that cookie.
      if (!pendingLocale && isLocale(saved) && !isLocale(cookie)) {
        writeCookie(LOCALE_COOKIE, saved);
        if (locale !== saved) refresh = true;
      } else if (!pendingLocale && !isLocale(cookie) && !isLocale(saved) && hasOtherOrenStorage(storageKeys())) {
        // The previous switcher removed oren-locale for an explicit English choice.
        writeCookie(LOCALE_COOKIE, DEFAULT_LOCALE);
        try {
          localStorage.setItem(LEGACY_LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
        } catch {
          // The cookie is the part the server reads.
        }
        if (locale !== DEFAULT_LOCALE) refresh = true;
      }
    } catch {
      // Ignore blocked storage and keep the negotiated language.
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isTimeZone(zone) && readCookie(TIME_ZONE_COOKIE) !== zone) {
      writeCookie(TIME_ZONE_COOKIE, zone);
      refresh = true;
    }
    if (refresh) router.refresh();
  }, [enabled, locale, router]);

  useEffect(() => {
    if (!enabled) return;
    function onStorage(event: StorageEvent) {
      if (event.key !== LEGACY_LOCALE_STORAGE_KEY || !isLocale(event.newValue)) return;
      if (readCookie(LOCALE_COOKIE) === event.newValue) return;
      rememberLocale(event.newValue);
      router.refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [enabled, router]);

  return null;
}
