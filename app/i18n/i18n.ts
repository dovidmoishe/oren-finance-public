"use client";

import { useLocale, useTimeZone, useTranslations } from "next-intl";
import type { Locale } from "./locales";
import { shownText, type ShownMessage } from "./message-error";

export type { MessageKey } from "./keys";
export type { ShownMessage } from "./message-error";
export { MessageKeyError, shownFromUnknown, shownKey, shownText } from "./message-error";

export type MessageValues = Record<string, string | number>;

export function useT() {
  return useTranslations();
}

/** Alias of the root translator. `ReturnType<typeof useTranslations>` drops dotted keys. */
export type Translate = ReturnType<typeof useT>;

export function useI18n() {
  const locale = useLocale();
  const timeZone = useTimeZone() ?? "UTC";
  const t = useT();
  return { locale: locale as Locale, timeZone, t };
}

/** Renders a stored key with the current catalog, or an already-literal API message. */
export function useShownMessage(message: ShownMessage | undefined): string | undefined {
  const t = useT();
  if (!message) return undefined;
  if (message.type === "text") return message.text;
  return shownText((key, values) => t(key as never, values as never), message);
}
