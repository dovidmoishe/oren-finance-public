"use client";

import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from "next-intl";
import type { ReactNode } from "react";
import { getMessageFallback, onIntlError } from "./intl-policy";

// onError and getMessageFallback are functions, so a server provider cannot
// pass them through. This nested provider adds the same policy on the client.
// next-intl 4.14.9 throws during SSR unless locale is an actual prop; it does
// not inherit the outer provider's locale on its own.
export function IntlErrorProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const messages = useMessages();
  const timeZone = useTimeZone();
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      onError={onIntlError}
      getMessageFallback={getMessageFallback}
      timeZone={timeZone}
    >
      {children}
    </NextIntlClientProvider>
  );
}
