"use client";

import { useT, type MessageKey, type MessageValues } from "./i18n";

/** Translated text for places that render a client child, such as shared empty states. */
export function T({ k, values }: { k: MessageKey; values?: MessageValues }) {
  return <>{useT()(k, values as never)}</>;
}
