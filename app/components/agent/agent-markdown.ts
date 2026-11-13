export type AgentInline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "link"; label: string; href: string };

export type AgentBlock =
  | { type: "paragraph"; lines: AgentInline[][] }
  | { type: "list"; ordered: boolean; items: AgentInline[][] }
  | { type: "details"; text: string };

const DETAILS_FENCE = /:::details\b[ \t]*\n?([\s\S]*?)\n?:::/gi;
const INLINE =
  /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<)]+)/g;
const MENU_PROMPT =
  /^(want me to|i can|options|which (one|of these)|next i can|let me know if you want|here are (a few|some) options)\b/i;

export function parseAgentMessage(raw: string): AgentBlock[] {
  const source = raw.replace(/\r\n/g, "\n");
  const blocks: AgentBlock[] = [];
  let last = 0;
  for (const match of source.matchAll(DETAILS_FENCE)) {
    const index = match.index ?? 0;
    blocks.push(...parseProse(source.slice(last, index)));
    const body = cleanDetails(match[1] ?? "");
    if (body) blocks.push({ type: "details", text: body });
    last = index + match[0].length;
  }
  blocks.push(...parseProse(source.slice(last)));
  return dropTrailingMenu(blocks.filter((block) => !isEmpty(block)));
}

export function linkTextForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "x.com" || host === "twitter.com") {
      const handle = parsed.pathname.split("/").filter(Boolean)[0];
      if (handle && handle !== "i" && handle !== "intent") return `@${handle}`;
    }
    return host;
  } catch {
    return url;
  }
}

function parseProse(source: string): AgentBlock[] {
  const chunks = source
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const blocks: AgentBlock[] = [];
  for (const chunk of chunks) {
    if (isDisclaimer(chunk)) continue;
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const unordered =
      lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line));
    const ordered =
      lines.length > 0 && lines.every((line) => /^\d+[.)]\s+/.test(line));
    if (unordered || ordered) {
      blocks.push({
        type: "list",
        ordered,
        items: lines.map((line) =>
          parseInlines(line.replace(/^([-*]|\d+[.)])\s+/, "")),
        ),
      });
      continue;
    }
    blocks.push({
      type: "paragraph",
      lines: lines.map((line) => parseInlines(line)),
    });
  }
  return blocks;
}

export function parseInlines(input: string): AgentInline[] {
  const inlines: AgentInline[] = [];
  let last = 0;
  for (const match of input.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last)
      inlines.push({ type: "text", text: input.slice(last, index) });
    if (match[1] && match[2]) {
      const href = safeHref(match[2]);
      inlines.push(
        href
          ? { type: "link", label: match[1], href }
          : { type: "text", text: match[0] },
      );
    } else if (match[3]) {
      inlines.push({ type: "strong", text: match[3] });
    } else if (match[4]) {
      const href = safeHref(trimUrlPunctuation(match[4]));
      inlines.push(
        href
          ? { type: "link", label: linkTextForUrl(href), href }
          : { type: "text", text: match[0] },
      );
    }
    last = index + match[0].length;
  }
  if (last < input.length)
    inlines.push({ type: "text", text: input.slice(last) });
  return inlines.filter(
    (inline) => inline.type !== "text" || inline.text.length > 0,
  );
}

function dropTrailingMenu(blocks: AgentBlock[]): AgentBlock[] {
  const last = blocks.at(-1);
  const previous = blocks.at(-2);
  if (
    last?.type === "list" &&
    previous?.type === "paragraph" &&
    last.items.length >= 2 &&
    isMenuPrompt(inlineText(previous.lines.flat()))
  ) {
    return blocks.slice(0, -2);
  }
  if (last?.type === "paragraph" && isInlineMenu(last.lines)) {
    return blocks.slice(0, -1);
  }
  return blocks;
}

function isInlineMenu(lines: AgentInline[][]): boolean {
  if (lines.length < 3) return false;
  if (!isMenuPrompt(inlineText(lines[0] ?? []))) return false;
  return lines
    .slice(1)
    .every((line) => /^\d+[.)]\s+/.test(inlineText(line).trim()));
}

function isMenuPrompt(text: string): boolean {
  const prompt = text.trim();
  return prompt.length > 0 && prompt.length <= 160 && MENU_PROMPT.test(prompt);
}

function isDisclaimer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 240) return false;
  return (
    /not financial advice/i.test(trimmed) ||
    /opinions are not facts/i.test(trimmed)
  );
}

function cleanDetails(body: string): string | undefined {
  const cleaned = body
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u2028|\u2029/g, "\n")
    .replace(/\(the tool's details, unchanged\)/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .join("\n");
  return cleaned || undefined;
}

function isEmpty(block: AgentBlock): boolean {
  if (block.type === "details") return !block.text.trim();
  if (block.type === "list") return block.items.length === 0;
  return block.lines.every((line) => line.length === 0);
}

function inlineText(inlines: AgentInline[]): string {
  return inlines
    .map((inline) => (inline.type === "link" ? inline.label : inline.text))
    .join("");
}

function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/, "");
}
