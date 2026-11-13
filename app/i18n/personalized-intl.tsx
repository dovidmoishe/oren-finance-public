import { cookies, headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { messagesFor } from "./catalog";
import { IntlErrorProvider } from "./intl-error";
import { LocaleSync } from "./locale-sync";
import { LOCALE_COOKIE, TIME_ZONE_COOKIE, isTimeZone, resolveLocale } from "./locales";

/** Cookie locale for /app, /connect and /settings. Public pages do not use this. */
export async function PersonalizedIntl({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));
  const zone = cookieStore.get(TIME_ZONE_COOKIE)?.value;
  const timeZone = zone && isTimeZone(zone) ? zone : "UTC";
  const messages = await messagesFor(locale);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <IntlErrorProvider>
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.lang=${JSON.stringify(locale)}` }} />
        <LocaleSync force />
        {children}
      </IntlErrorProvider>
    </NextIntlClientProvider>
  );
}
