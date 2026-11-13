"use client";

import { useEffect } from "react";
import { RouteErrorPage } from "@/components/errors";
import { cookieValue, isLocale, LOCALE_COOKIE } from "@/i18n/locales";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html
      lang="en"
      ref={(node) => {
        const value = cookieValue(document.cookie, LOCALE_COOKIE);
        if (node && isLocale(value)) node.lang = value;
      }}
    >
      <body>
        <RouteErrorPage reset={reset} />
      </body>
    </html>
  );
}
