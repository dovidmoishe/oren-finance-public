// @ts-check

/**
 * @typedef {{src: string, alt: string, width: number, height: number}} Screenshot
 * @typedef {{src: string, poster: string, label: string, caption: string, width: number, height: number}} Film
 * @typedef {{slug: string, date: string, sequence?: number, status: 'draft' | 'published', title: string, summary: string, sections?: {heading: 'Added' | 'Improved' | 'Fixed', items: (string | {title: string, description: string})[]}[], links?: {label: string, href: string}[], screenshots?: Screenshot[], video?: Film}} ChangelogEntry
 */

/** @param {unknown} value */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === 'string' && value.trim().length > 0; }

/** Allow app paths and HTTPS links, never protocol-relative or executable URLs.
 * @param {unknown} value @returns {value is string}
 */
export function supportedLink(value) {
  if (!text(value) || /[\s\\\u0000-\u001f]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}

/** @param {Record<string, unknown>} media @param {string[]} fields */
function validateMedia(media, fields) {
  for (const key of fields) if (!text(media[key])) throw new Error(`Media needs ${key}`);
  for (const key of ['src', 'poster']) {
    if (media[key] !== undefined && !supportedLink(media[key])) throw new Error(`Unsupported media ${key}`);
  }
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(media[key]) || Number(media[key]) <= 0) throw new Error(`Invalid media ${key}`);
  }
}

/** Validate the entire collection, including drafts, before rendering or publishing.
 * @param {unknown[]} values @returns {ChangelogEntry[]}
 */
export function validateEntries(values) {
  const slugs = new Set();
  return values.map(value => {
    const entry = record(value);
    for (const key of ['slug', 'date', 'status', 'title', 'summary']) {
      if (!text(entry[key])) throw new Error(`Entry needs ${key}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(entry.slug))) throw new Error('Invalid entry slug');
    if (slugs.has(entry.slug)) throw new Error(`Duplicate entry slug: ${entry.slug}`);
    slugs.add(entry.slug);
    const date = String(entry.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`Invalid release date: ${date}`);
    if (entry.sequence !== undefined && (!Number.isSafeInteger(entry.sequence) || Number(entry.sequence) < 0)) throw new Error('Invalid release sequence');
    if (!['draft', 'published'].includes(String(entry.status))) throw new Error('Invalid entry status');
    if (entry.sections !== undefined) {
      if (!Array.isArray(entry.sections)) throw new Error('Sections must be an array');
      const headings = new Set();
      for (const value of entry.sections) {
        const section = record(value);
        if (!['Added', 'Improved', 'Fixed'].includes(String(section.heading)) || headings.has(section.heading)) throw new Error('Invalid or duplicate section heading');
        headings.add(section.heading);
        if (!Array.isArray(section.items) || !section.items.length || !section.items.every(item => text(item) || (item && typeof item === 'object' && !Array.isArray(item) && text(item.title) && text(item.description)))) throw new Error('Section needs text or titled description items');
      }
    }
    if (entry.links !== undefined) {
      if (!Array.isArray(entry.links)) throw new Error('Links must be an array');
      for (const value of entry.links) {
        const link = record(value);
        if (!text(link.label) || !supportedLink(link.href)) throw new Error('Invalid entry link');
      }
    }
    if (entry.screenshots !== undefined) {
      if (!Array.isArray(entry.screenshots)) throw new Error('Screenshots must be an array');
      for (const value of entry.screenshots) validateMedia(record(value), ['src', 'alt']);
    }
    if (entry.video !== undefined) validateMedia(record(entry.video), ['src', 'poster', 'label', 'caption']);
    return /** @type {ChangelogEntry} */ (entry);
  });
}

/** @param {string | undefined} nodeEnv @param {string | undefined} preview */
export function draftsEnabled(nodeEnv, preview) { return nodeEnv === 'development' && preview === '1'; }

/** @param {ChangelogEntry[]} entries @param {boolean} [preview] */
export function visibleEntries(entries, preview = false) {
  return entries.filter(entry => entry.status === 'published' || preview)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.sequence ?? 0) - (a.sequence ?? 0) || a.slug.localeCompare(b.slug));
}

/** @param {ChangelogEntry[]} entries @param {string} slug @param {boolean} [preview] */
export function findEntry(entries, slug, preview = false) {
  return visibleEntries(entries, preview).find(entry => entry.slug === slug);
}

/** @param {ChangelogEntry[]} entries */
export function groupEntries(entries) {
  /** @type {{date: string, entries: ChangelogEntry[]}[]} */
  const groups = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.date === entry.date) last.entries.push(entry);
    else groups.push({date: entry.date, entries: [entry]});
  }
  return groups;
}

/** @param {string} date */
export function formatReleaseDate(date) {
  return new Intl.DateTimeFormat('en-US', {month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(`${date}T12:00:00Z`));
}
