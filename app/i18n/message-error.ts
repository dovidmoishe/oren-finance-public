import type { MessageKey } from "./keys";

/** A translated error stored by key so a later language change can render it again. */
export class MessageKeyError extends Error {
  readonly messageKey: MessageKey;
  readonly values?: Record<string, string | number>;

  constructor(messageKey: MessageKey, values?: Record<string, string | number>) {
    super(messageKey);
    this.name = "MessageKeyError";
    this.messageKey = messageKey;
    this.values = values;
  }
}

export type ShownMessage =
  | { type: "key"; key: MessageKey; values?: Record<string, string | number> }
  | { type: "text"; text: string };

export function shownKey(key: MessageKey, values?: Record<string, string | number>): ShownMessage {
  return { type: "key", key, values };
}

export function shownFromUnknown(cause: unknown, fallback: MessageKey): ShownMessage {
  if (cause instanceof MessageKeyError) return { type: "key", key: cause.messageKey, values: cause.values };
  if (cause instanceof Error && cause.message) return { type: "text", text: cause.message };
  return { type: "key", key: fallback };
}

type LooseTranslate = (key: string, values?: Record<string, string | number>) => string;

export function shownText(translate: LooseTranslate, message: ShownMessage | undefined): string | undefined {
  if (!message) return undefined;
  if (message.type === "text") return message.text;
  return translate(message.key, message.values);
}
