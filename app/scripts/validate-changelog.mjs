import { readdirSync, readFileSync } from 'node:fs';
import { validateEntries } from '../content/changelog/model.mjs';

const directory = new URL('../content/changelog/', import.meta.url);
const files = readdirSync(directory).filter(file => file.endsWith('.json'));
try {
  const entries = validateEntries(files.map(file => {
    try { return JSON.parse(readFileSync(new URL(file, directory), 'utf8')); }
    catch { throw new Error(`Cannot parse ${file}`); }
  }));
  console.log(`Validated ${entries.length} changelog entries (${entries.filter(entry => entry.status === 'published').length} published).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
