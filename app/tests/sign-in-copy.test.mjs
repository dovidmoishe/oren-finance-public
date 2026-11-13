import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);

function load(file) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Intl, console, require });
  return exports;
}

const errors = load("../components/auth/sign-in-error.ts");
const format = load("../components/ui/utils.ts");

test("known Privy failures become catalog keys and the raw message stays out of the UI", () => {
  const seen = [];
  const original = console.error;
  console.error = (...args) => seen.push(args);
  try {
    assert.equal(errors.signInErrorKey({ privyErrorCode: "invalid_credentials", message: "Invalid code" }, "verify"), "auth.codeInvalid");
    assert.equal(errors.signInErrorKey(new Error("This code is invalid or expired"), "verify"), "auth.codeInvalid");
    assert.equal(errors.signInErrorKey({ privyErrorCode: "too_many_requests", message: "Too many requests" }, "send"), "auth.rateLimited");
    assert.equal(errors.signInErrorKey(new Error("Invalid email address"), "send"), "auth.emailInvalid");
    assert.equal(errors.signInErrorKey({ code: "disallowed_plus_email" }, "send"), "auth.emailInvalid");
    assert.equal(errors.signInErrorKey(new TypeError("Failed to fetch"), "send"), "auth.network");
    assert.equal(errors.signInErrorKey({ privyErrorCode: "client_request_timeout" }, "verify"), "auth.network");
    assert.equal(errors.signInErrorKey(new Error("Privy exploded: raw sdk text"), "send"), "auth.sendFailed");
    assert.equal(errors.signInErrorKey(new Error("Privy exploded: raw sdk text"), "verify"), "auth.verifyFailed");
  } finally {
    console.error = original;
  }
  assert.equal(seen.length, 9);
  assert.match(String(seen[8][0]), /raw sdk text/);
});

test("sign-in copy is translated in German and French", () => {
  const en = JSON.parse(readFileSync(new URL("../i18n/messages/en.json", import.meta.url), "utf8")).auth;
  const skip = new Set(["codePlaceholder"]);
  for (const locale of ["de", "fr", "zh-CN", "zh-TW", "id", "vi", "uk", "pt-BR"]) {
    const auth = JSON.parse(readFileSync(new URL(`../i18n/messages/${locale}.json`, import.meta.url), "utf8")).auth;
    for (const [key, value] of Object.entries(en)) {
      if (skip.has(key) || /^[^A-Za-z]*$/.test(value) || value.includes("@")) continue;
      assert.notEqual(auth[key], value, `${locale} auth.${key}`);
    }
  }
});

test("the email step renders catalog copy and never the raw SDK string", () => {
  const source = readFileSync(new URL("../components/auth/email-login.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /cause\.message/);
  const dialog = readFileSync(new URL("../components/auth/privy-session.tsx", import.meta.url), "utf8");
  assert.match(dialog, /aria-label=\{t\("auth\.title"\)\}/);
  assert.match(dialog, /t\("auth\.close"\)/);
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(id) {
      if (id === "@privy-io/react-auth") return { Captcha: () => null, useLoginWithEmail: () => ({ sendCode() {}, loginWithCode() {} }) };
      if (id === "@/i18n/i18n") return require("@/i18n/i18n");
      if (id === "./sign-in-error") return errors;
      if (id === "react") return require("react");
      if (id === "react/jsx-runtime") return require("react/jsx-runtime");
      throw new Error(id);
    },
  });
  const html = renderToStaticMarkup(createElement(exports.EmailLogin, { onComplete() {} }));
  assert.match(html, /Sign in to Oren/);
  assert.match(html, /one-time code/);
  assert.match(html, /Email address/);
  assert.match(html, /you@example.com/);
  assert.match(html, /Continue/);
  assert.doesNotMatch(html, /Unable to send a code/);
});

test("compact USD liquidity follows the active locale", () => {
  const en = format.formatCompactCurrency(1_200_000, "en");
  const de = format.formatCompactCurrency(1_200_000, "de");
  assert.match(en, /\$1\.20M/);
  assert.notEqual(de, en);
  assert.match(de, /1,2/);
  assert.equal(format.formatCompactCurrency(undefined, "en"), format.formatCompactCurrency(0, "en"));
});
