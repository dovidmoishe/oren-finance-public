// Component tests compile one file at a time with a stubbed React, so they
// can't load the next-intl provider. This serves `@/i18n/i18n` and `@/i18n/t`
// with the English catalog, rendered synchronously.
import Module from "node:module";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";

const en = JSON.parse(readFileSync(new URL("../../i18n/messages/en.json", import.meta.url), "utf8"));
const translator = createTranslator({ locale: "en", messages: en, onError() {} });

function t(key, values) {
  const withCount = values && "count" in values ? values : { ...values, count: values?.count ?? 0 };
  try {
    return translator(key, key.includes(".") ? withCount : values);
  } catch {
    try {
      return translator(key, withCount);
    } catch {
      return key;
    }
  }
}

class MessageKeyError extends Error {
  constructor(messageKey, values) {
    super(messageKey);
    this.name = "MessageKeyError";
    this.messageKey = messageKey;
    this.values = values;
  }
}

function shownKey(key, values) {
  return { type: "key", key, values };
}

function shownFromUnknown(cause, fallback) {
  if (cause instanceof MessageKeyError) return { type: "key", key: cause.messageKey, values: cause.values };
  if (cause instanceof Error && cause.message) return { type: "text", text: cause.message };
  return { type: "key", key: fallback };
}

function shownText(translate, message) {
  if (!message) return undefined;
  if (message.type === "text") return message.text;
  return translate(message.key, message.values);
}

function useShownMessage(message) {
  return shownText(t, message);
}

export const englishI18n = {
  useI18n: () => ({ locale: "en", timeZone: "UTC", t }),
  useT: () => t,
  useShownMessage,
  MessageKeyError,
  shownKey,
  shownFromUnknown,
  shownText,
};
export const englishT = { T: ({ k, values }) => t(k, values) };

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@/i18n/i18n") return englishI18n;
  if (request === "@/i18n/t") return englishT;
  return load.call(this, request, ...rest);
};
