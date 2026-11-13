import type { MessageKeys, Messages, NestedKeyOf } from "next-intl";

/** Every leaf key in the English catalog. Misspelled keys fail `tsc`. */
export type MessageKey = MessageKeys<Messages, NestedKeyOf<Messages>>;
