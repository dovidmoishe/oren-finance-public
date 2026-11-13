import 'server-only';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { draftsEnabled, findEntry, groupEntries, validateEntries, visibleEntries } from './model.mjs';

// Read once per server/build process. New files are picked up by the next deployment.
const directory = path.join(process.cwd(), 'content/changelog');
const entries = validateEntries(readdirSync(directory).filter(file => file.endsWith('.json')).sort().map(file => {
  try { return JSON.parse(readFileSync(path.join(directory, file), 'utf8')); }
  catch { throw new Error(`Cannot parse changelog entry: ${file}`); }
}));

export const previewDrafts = draftsEnabled(process.env.NODE_ENV, process.env.OREN_CHANGELOG_PREVIEW);
export const getChangelog = () => visibleEntries(entries, previewDrafts);
export const getChangelogGroups = () => groupEntries(getChangelog());
export const getChangelogEntry = (slug: string) => findEntry(entries, slug, previewDrafts);
