import { getRequestConfig } from "next-intl/server";
import { messagesFor } from "./catalog";
import { getMessageFallback, onIntlError } from "./intl-policy";
import { DEFAULT_LOCALE } from "./locales";

// English only, and no cookie or header reads. Personalized layouts read the
// locale themselves. Reading the request cookie here would make every page dynamic.
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  timeZone: "UTC",
  messages: await messagesFor(DEFAULT_LOCALE),
  onError: onIntlError,
  getMessageFallback,
}));
