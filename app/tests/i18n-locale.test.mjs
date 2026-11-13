import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, useTranslations, createTranslator } from "next-intl";

function loadTs(file) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, Set, Number, String, Date });
  return exports;
}

const locales = loadTs("../i18n/locales.ts");
const format = loadTs("../components/ui/utils.ts");
const en = JSON.parse(readFileSync(new URL("../i18n/messages/en.json", import.meta.url), "utf8"));
const de = JSON.parse(readFileSync(new URL("../i18n/messages/de.json", import.meta.url), "utf8"));

test("the server locale prefers the NEXT_LOCALE cookie over Accept-Language", () => {
  assert.equal(locales.resolveLocale("de", "en-US,en;q=0.9"), "de");
  assert.equal(locales.resolveLocale("pt-BR", "fr-CA,fr;q=0.8"), "pt-BR");
  assert.equal(locales.LOCALE_COOKIE, "NEXT_LOCALE");
  const request = readFileSync(new URL("../i18n/request.ts", import.meta.url), "utf8");
  const personalized = readFileSync(new URL("../i18n/personalized-intl.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(request, /next\/headers/);
  assert.match(personalized, /resolveLocale\(cookieStore\.get\(LOCALE_COOKIE\)\?\.value/);
  assert.match(personalized, /messagesFor\(locale\)/);
});

test("an invalid cookie falls through to Accept-Language and then English", () => {
  assert.equal(locales.resolveLocale("en-US", "fr-CA,fr;q=0.8,en;q=0.5"), "fr");
  assert.equal(locales.resolveLocale("nope", "zh-Hans,en;q=0.5"), "zh-CN");
  assert.equal(locales.resolveLocale(undefined, "zh-Hant-TW,zh;q=0.8"), "zh-TW");
  assert.equal(locales.resolveLocale(undefined, "pt-PT,pt;q=0.9"), "pt-BR");
  assert.equal(locales.resolveLocale(undefined, "de-AT,de;q=0.8"), "de");
  assert.equal(locales.resolveLocale(undefined, "xx,yy;q=0.5"), "en");
  assert.equal(locales.resolveLocale(undefined, "fr;q=0.1,uk;q=0.9"), "uk");
  assert.equal(locales.resolveLocale(undefined, null), "en");
});

function Probe({ code }) {
  const t = useTranslations();
  return t(code);
}

test("a catalog render follows the resolved cookie locale", () => {
  const locale = locales.resolveLocale("de", "en");
  const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: de, timeZone: "UTC" },
    createElement(Probe, { code: "language.title" })));
  assert.equal(html, "Sprache");
  assert.notEqual(html, "Language");
});

test("stored error keys render again after the catalog changes", () => {
  const stored = { type: "key", key: "transfer.recoveryFailed" };
  function text(messages, locale) {
    const translate = createTranslator({ locale, messages });
    return stored.type === "text" ? stored.text : translate(stored.key);
  }
  const english = text(en, "en");
  const german = text(de, "de");
  assert.match(english, /Unable to check previous transfers/);
  assert.notEqual(english, german);
  const first = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" },
    createElement(Probe, { code: stored.key })));
  const second = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "de", messages: de, timeZone: "UTC" },
    createElement(Probe, { code: stored.key })));
  assert.equal(first, english);
  assert.equal(second, german);
});

test("dates, currency and relative time follow the active locale", () => {
  assert.match(format.formatDate("2026-03-15", "en"), /Mar/);
  assert.match(format.formatDate("2026-03-15", "de"), /Mär/);
  assert.notEqual(format.formatDate("2026-03-15", "en"), format.formatDate("2026-03-15", "de"));
  assert.match(format.formatCurrency(1234.5, "en"), /\$1,234\.50/);
  assert.match(format.formatCurrency(1234.5, "de"), /1\.234,50/);
  const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assert.match(format.formatRelativeTime(past, "en", { justNow: "just now", unknown: "Unknown" }), /day|ago/);
  assert.match(format.formatRelativeTime(past, "de", { justNow: "gerade eben", unknown: "Unbekannt" }), /Tag/);
});

test("a returning browser with no saved locale is pinned to English", () => {
  assert.equal(locales.hasOtherOrenStorage(["oren.active-wallet.v1"]), true);
  assert.equal(locales.hasOtherOrenStorage(["oren-agent-panel-v1", "oren-locale"]), true);
  assert.equal(locales.hasOtherOrenStorage(["oren-locale"]), false);
  assert.equal(locales.hasOtherOrenStorage(["theme"]), false);
  assert.equal(locales.isPersonalizedPath("/app"), true);
  assert.equal(locales.isPersonalizedPath("/app/markets"), true);
  assert.equal(locales.isPersonalizedPath("/connect/mcp"), true);
  assert.equal(locales.isPersonalizedPath("/settings/mcp"), true);
  assert.equal(locales.isPersonalizedPath("/"), false);
  assert.equal(locales.isPersonalizedPath("/changelog"), false);
  assert.equal(locales.isPersonalizedPath("/agents"), false);
});

test("trading copy keeps its English meaning", () => {
  const t = createTranslator({ locale: "en", messages: en });
  assert.equal(t("transfer.confirm"), "Confirm transfer");
  assert.match(t("transfer.confirmCheck"), /cannot be reversed/);
  assert.equal(t("ticket.buy"), "Buy");
  assert.equal(t("ticket.sell"), "Sell");
  assert.equal(t("review.confirmBuy"), "Confirm buy");
  assert.equal(t("review.priceMoved"), "Price moved");
  assert.match(t("grant.removalRetry"), /signer removal/);
  assert.match(t("grant.understand"), /signer will be removed/);
});
