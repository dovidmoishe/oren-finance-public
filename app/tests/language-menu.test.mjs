import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement } from "react";
import { jsx as realJsx, jsxs as realJsxs, Fragment } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);

function load(file, sandbox) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: sandbox.require, Intl, Set, Number, String, Date, decodeURIComponent, ...sandbox });
  return exports;
}

const locales = load("../i18n/locales.ts", {});

test("NEXT_LOCALE is still found when another cookie is joined without a space", () => {
  const preview = "__Host-oren-preview=session;NEXT_LOCALE=de";
  assert.equal(locales.cookieValue(preview, "NEXT_LOCALE"), "de");
  assert.equal(locales.cookieValue("NEXT_LOCALE=pt-BR; __Host-oren-preview=session", "NEXT_LOCALE"), "pt-BR");
  assert.equal(locales.cookieValue("__Host-oren-preview=NEXT_LOCALE=en", "NEXT_LOCALE"), undefined);
});

test("the locale cookie is host-only, Lax, and Secure only on https", async () => {
  const seen = [];
  function persist(proto) {
    return load("../i18n/persist-locale.ts", {
      require(id) {
        if (id === "next/headers") return {
          cookies: async () => ({ set: (name, value, options) => seen.push([name, value, options]) }),
          headers: async () => ({ get: (name) => (name === "x-forwarded-proto" ? proto : null) }),
        };
        if (id === "./locales") return locales;
        throw new Error(id);
      },
    });
  }
  await persist("https").persistLocale("de");
  await persist(null).persistLocale("fr");
  await persist("https").persistLocale("nope");
  assert.equal(seen.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), ["NEXT_LOCALE", "de", { path: "/", maxAge: locales.LOCALE_MAX_AGE, sameSite: "lax", secure: true }]);
  assert.equal(JSON.parse(JSON.stringify(seen[1][2])).secure, false);
  assert.equal(JSON.parse(JSON.stringify(seen[1][2])).domain, undefined);
});

test("a language row commits on pointerdown when the click never arrives", async () => {
  const remembered = [];
  const persisted = [];
  let refreshes = 0;
  const rows = [];
  const menu = load("../components/language/language-menu.tsx", {
    require(id) {
      if (id === "react/jsx-runtime") return {
        Fragment,
        jsx(type, props, key) {
          if (type === "button" && props?.lang) rows.push(props);
          return realJsx(type, props, key);
        },
        jsxs(type, props, key) {
          if (type === "button" && props?.lang) rows.push(props);
          return realJsxs(type, props, key);
        },
      };
      if (id === "react") return require("react");
      if (id === "next/navigation") return { useRouter: () => ({ refresh: () => { refreshes += 1; } }) };
      if (id === "@hugeicons/core-free-icons") return { Globe02Icon: {}, Tick02Icon: {} };
      if (id === "@hugeicons/react") return { HugeiconsIcon: () => null };
      if (id === "@/components/ui") return { cn: (...parts) => parts.filter(Boolean).join(" ") };
      if (id === "@/i18n/i18n") return { useI18n: () => ({ locale: "en", t: (key) => key }) };
      if (id === "@/i18n/locale-sync") return { rememberLocale: (locale) => remembered.push(locale) };
      if (id === "@/i18n/locales") return locales;
      if (id === "@/i18n/persist-locale") return { persistLocale: async (locale) => { persisted.push(locale); } };
      throw new Error(id);
    },
  });
  const html = renderToStaticMarkup(createElement(menu.LanguageMenu));
  assert.match(html, /Deutsch/);
  const deutsch = rows.find((row) => row.lang === "de");
  let prevented = false;
  deutsch.onPointerDown({ timeStamp: 1000, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(remembered, ["de"]);
  assert.deepEqual(persisted, ["de"]);
  deutsch.onClick({ timeStamp: 1008 });
  assert.deepEqual(remembered, ["de"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 1);

  rows.length = 0;
  renderToStaticMarkup(createElement(menu.LanguageMenu));
  rows.find((row) => row.lang === "en").onPointerDown({ timeStamp: 2000, preventDefault() {} });
  assert.deepEqual(remembered, ["de"]);

  rows.length = 0;
  renderToStaticMarkup(createElement(menu.LanguageMenu));
  rows.find((row) => row.lang === "fr").onClick({ timeStamp: 3000 });
  assert.deepEqual(remembered, ["de", "fr"]);
});

test("the language popover itself is not transformed, so iOS hit targets stay put", async () => {
  const entry = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const stylesheet = await compile(readFileSync(entry, "utf8"), {
    base: dirname(entry),
    async loadStylesheet(id, base) {
      const path = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : resolve(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  const css = stylesheet.build([]);
  const popover = css.match(/\.oren-account-menu\s*\{[^}]*\}/g);
  const surface = css.match(/\.oren-account-menu-surface\s*\{[^}]*\}/)?.[0];
  assert.ok(popover?.length, "the compiled stylesheet contains the popover rules");
  assert.doesNotMatch(popover.join("\n"), /\b(?:transform|scale|rotate|translate)\s*:/);
  assert.doesNotMatch(css, /\.oren-account-menu:popover-open\s*\{[^}]*\b(?:transform|scale|rotate|translate)\s*:/);
  assert.match(surface ?? "", /transform:\s*scale\(/);
  const menu = readFileSync(new URL("../components/language/language-menu.tsx", import.meta.url), "utf8");
  assert.match(menu, /onPointerDown/);
  assert.match(menu, /oren-account-menu-surface/);
});
