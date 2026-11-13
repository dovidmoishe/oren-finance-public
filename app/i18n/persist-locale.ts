"use server";

import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, LOCALE_MAX_AGE, isLocale, type Locale } from "./locales";

/** Sets NEXT_LOCALE on the response, which Safari applies before the next refresh. */
export async function persistLocale(locale: Locale) {
  if (!isLocale(locale)) return;
  const forwarded = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_MAX_AGE,
    sameSite: "lax",
    secure: forwarded === "https",
  });
}

