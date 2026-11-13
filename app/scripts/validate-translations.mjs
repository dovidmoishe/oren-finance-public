// Checks every language file against English: the same keys, the same ICU
// arguments, a plural `other` branch, and messages that format without error.
import { readdirSync, readFileSync } from "node:fs";
import { createTranslator } from "next-intl";

const dir = new URL("../i18n/messages/", import.meta.url);

function collectArguments(message) {
  const args = new Set();
  let i = 0;
  function read(untilClose) {
    while (i < message.length) {
      if (message.startsWith("''", i)) {
        i += 2;
        continue;
      }
      if (message[i] === "}") {
        if (untilClose) i += 1;
        else i += 1;
        if (untilClose) return;
        continue;
      }
      if (message[i] !== "{") {
        i += 1;
        continue;
      }
      i += 1;
      const start = i;
      while (i < message.length && /\w/.test(message[i])) i += 1;
      const name = message.slice(start, i);
      let look = i;
      while (message[look] === " ") look += 1;
      if (name && (message[look] === "}" || message[look] === ",")) {
        args.add(name);
        i = look;
        if (message[i] === "}") {
          i += 1;
          continue;
        }
        i += 1;
        while (message[i] === " ") i += 1;
        while (i < message.length && /[A-Za-z]/.test(message[i])) i += 1;
        read(true);
        continue;
      }
      i = start;
      read(true);
    }
  }
  read(false);
  return [...args].sort();
}

function leaves(value, prefix = "") {
  if (typeof value === "string") return [[prefix, value]];
  if (!value || typeof value !== "object") return [[prefix, ""]];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

function sampleValues(names) {
  return Object.fromEntries(names.map((name) => [name, name === "count" ? 1 : "x"]));
}

const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
const catalogs = new Map(files.map((file) => [file, JSON.parse(readFileSync(new URL(file, dir), "utf8"))]));
const english = catalogs.get("en.json");
const englishLeaves = leaves(english);
const englishByKey = new Map(englishLeaves);
let problems = 0;

function problem(text) {
  console.error(text);
  problems += 1;
}

for (const [key, text] of englishLeaves) {
  if (!text.trim()) problem(`en.json: empty text for ${key}`);
  if (text.includes(", plural,") && !/\bother\s*\{/.test(text)) problem(`en.json: ${key} plural is missing other`);
}

for (const [file, messages] of catalogs) {
  if (file === "en.json") continue;
  const seen = new Set();
  const translator = createTranslator({
    locale: file.replace(/\.json$/, ""),
    messages,
    onError(error) {
      throw error;
    },
  });
  for (const [key, text] of leaves(messages)) {
    seen.add(key);
    const expected = englishByKey.get(key);
    if (expected === undefined) {
      problem(`${file}: unknown key ${key}`);
      continue;
    }
    if (typeof text !== "string" || !text.trim()) {
      problem(`${file}: empty text for ${key}`);
      continue;
    }
    const actualArgs = collectArguments(text).join(",");
    const expectedArgs = collectArguments(expected).join(",");
    if (actualArgs !== expectedArgs) problem(`${file}: ${key} has {${actualArgs}} but English has {${expectedArgs}}`);
    const englishPlural = expected.includes(", plural,");
    const translatedPlural = text.includes(", plural,");
    if (englishPlural !== translatedPlural) problem(`${file}: ${key} ${englishPlural ? "must be a plural" : "must not be a plural"}`);
    if (translatedPlural && !/\bother\s*\{/.test(text)) problem(`${file}: ${key} plural is missing other`);
    const names = collectArguments(expected);
    for (const count of [0, 1, 2, 5]) {
      try {
        const formatted = translator(key, { ...sampleValues(names), ...(names.includes("count") ? { count } : {}) });
        if (typeof formatted !== "string" || !formatted.trim()) problem(`${file}: ${key} formatted empty`);
      } catch (error) {
        problem(`${file}: ${key} failed to format (${error instanceof Error ? error.message.split("\n")[0] : error})`);
        break;
      }
    }
  }
  for (const key of englishByKey.keys()) {
    if (!seen.has(key)) problem(`${file}: missing ${key}`);
  }
}

if (problems) {
  console.error(`${problems} translation problem(s).`);
  process.exit(1);
}
console.log("Translations match English keys and placeholders.");
