import { IntlErrorCode, type IntlError } from "next-intl";

/** Missing catalog keys log in development and render the key. Formatting bugs always log. */
export function onIntlError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) {
    if (process.env.NODE_ENV !== "production") console.error(error);
    return;
  }
  console.error(error);
}

export function getMessageFallback({ namespace, key }: { namespace?: string; key?: string }) {
  return [namespace, key].filter((part) => part != null && part !== "").join(".");
}
