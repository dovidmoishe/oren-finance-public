import type { Locale } from "./locales";

/** One catalog. The import stays server-side; the client receives only the chosen locale. */
export async function messagesFor(locale: Locale) {
  switch (locale) {
    case "zh-CN":
      return (await import("./messages/zh-CN.json")).default;
    case "zh-TW":
      return (await import("./messages/zh-TW.json")).default;
    case "fr":
      return (await import("./messages/fr.json")).default;
    case "id":
      return (await import("./messages/id.json")).default;
    case "vi":
      return (await import("./messages/vi.json")).default;
    case "uk":
      return (await import("./messages/uk.json")).default;
    case "de":
      return (await import("./messages/de.json")).default;
    case "pt-BR":
      return (await import("./messages/pt-BR.json")).default;
    default:
      return (await import("./messages/en.json")).default;
  }
}
