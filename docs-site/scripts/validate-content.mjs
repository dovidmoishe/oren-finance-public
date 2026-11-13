import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../content/docs/', import.meta.url));
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const files = walk(root);
const pages = files.filter((file) => file.endsWith('.mdx'));
const routes = new Set(pages.map((file) => {
  const slug = path.relative(root, file).replaceAll('\\', '/').replace(/\.mdx$/, '').replace(/(^|\/)index$/, '');
  return `/docs/${slug}`.replace(/\/$/, '');
}));
const errors = [];
for (const file of pages) {
  const text = readFileSync(file, 'utf8');
  if (!/^---\r?\n[\s\S]*?title: .+\r?\n[\s\S]*?description: .+\r?\n---/.test(text)) errors.push(`Missing frontmatter: ${file}`);
  for (const [, url] of text.matchAll(/\]\((\/docs[^)#\s]*)/g)) {
    if (!routes.has(url.replace(/\/$/, ''))) errors.push(`Broken link ${url} in ${file}`);
  }
}
for (const file of files.filter((file) => file.endsWith('meta.json'))) {
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  const local = readdirSync(path.dirname(file), { withFileTypes: true });
  const names = new Set(local.filter((entry) => entry.isDirectory() || entry.name.endsWith('.mdx')).map((entry) => entry.name.replace(/\.mdx$/, '')));
  for (const entry of meta.pages ?? []) {
    if (entry.startsWith('---')) continue;
    if (!names.has(entry)) errors.push(`Invalid navigation entry ${entry} in ${file}`);
    names.delete(entry);
  }
  for (const name of names) errors.push(`Missing navigation entry ${name} in ${file}`);
}
const implementation = readFileSync(new URL('../../api/src/mcp-auth/mcp-resource.ts', import.meta.url), 'utf8');
const tools = [...implementation.matchAll(/server\.registerTool\(\s*'([^']+)'/g)].map((match) => match[1]);
const documented = [...readFileSync(path.join(root, 'mcp/tools.mdx'), 'utf8').matchAll(/^### `([^`]+)`/gm)].map((match) => match[1]);
for (const name of new Set([...tools, ...documented])) {
  if (!tools.includes(name) || !documented.includes(name)) errors.push(`Tool reference differs from implementation: ${name}`);
}
const inventory = readFileSync(path.join(root, 'tools.mdx'), 'utf8');
for (const name of tools) {
  if (!inventory.includes('`' + name + '`')) errors.push(`MCP tool missing from public overview: ${name}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Validated ${pages.length} documents, navigation, links and ${tools.length} public MCP tools.`);
