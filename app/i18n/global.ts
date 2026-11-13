import type { Locale } from "./locales";
import type messages from "./messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
