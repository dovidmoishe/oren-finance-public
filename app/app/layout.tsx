import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";
import { PreviewBanner } from "@/components/preview-banner";
import en from "@/i18n/messages/en.json";
import { IntlErrorProvider } from "@/i18n/intl-error";
import { LocaleSync } from "@/i18n/locale-sync";
import { DEFAULT_LOCALE } from "@/i18n/locales";

export const metadata: Metadata = {
  metadataBase: new URL("https://oren.finance"),
  title: "Oren",
  description: "Tokenized equities portfolio and investing copilot.",
  openGraph: { locale: "en_US" },
};

// English, with no cookies() or headers(), so marketing pages can stay static.
// /app, /connect and /settings replace this provider with the cookie locale.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      dir="ltr"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground font-sans selection:bg-[#111111] selection:text-white">
        <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={en} timeZone="UTC">
          <IntlErrorProvider>
            <LocaleSync />
            <PreviewBanner />
            {children}
          </IntlErrorProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
