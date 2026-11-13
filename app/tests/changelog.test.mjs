import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as model from '../content/changelog/model.mjs';
import { draftsEnabled, findEntry, formatReleaseDate, groupEntries, supportedLink, validateEntries, visibleEntries } from '../content/changelog/model.mjs';

const entry = (overrides = {}) => ({slug: 'release', date: '2026-10-31', status: 'published', title: 'Release', summary: 'Something shipped.', ...overrides});

test('rejects missing fields, duplicate slugs, invalid dates and malformed content', () => {
  for (const override of [
    {sequence: -1}, {sequence: 1.5}, {sequence: '2'}, {sequence: null}, {sequence: Number.MAX_SAFE_INTEGER + 1},
    {title: ' '}, {slug: '../escape'}, {date: '2026-02-30'}, {date: 'yesterday'}, {status: 'scheduled'},
    {sections: [{heading: 'Coming soon', items: ['No']}]}, {sections: [{heading: 'Added', items: []}]},
    {sections: [{heading: 'Added', items: ['Yes']}, {heading: 'Added', items: ['Again']}]},
    {links: [{label: 'Unsafe', href: 'javascript:alert(1)'}]},
    {video: {src: '/videos/a.mp4'}}, {screenshots: [{src: '/image.png', alt: '', width: 10, height: 10}]},
    {screenshots: [{src: '/image.png', alt: 'Screen', width: -1, height: 10}]},
  ]) assert.throws(() => validateEntries([entry(override)]));
  assert.throws(() => validateEntries([entry(), entry()]));
  assert.equal(validateEntries([entry({date: '2024-02-29'})]).length, 1);
});

test('accepts titled changes alongside plain text and rejects incomplete change objects', () => {
  const sections = [{heading: 'Added', items: ['A small fix.', {title: 'A release film', description: 'Watch the story.'}]}];
  assert.equal(validateEntries([entry({sections})])[0].sections[0].items.length, 2);
  for (const item of [{title: 'Missing description'}, {title: '', description: 'Text'}, null, 12, ['Nested']]) {
    assert.throws(() => validateEntries([entry({sections: [{heading: 'Added', items: [item]}]})]));
  }
});
test('supports app paths and HTTPS while rejecting executable and ambiguous links', () => {
  for (const href of ['/token', '/changelog#latest', 'https://oren.finance/token']) assert.equal(supportedLink(href), true);
  for (const href of ['//evil.test', '/\\evil.test', 'javascript:alert(1)', 'data:text/html,no', 'http://example.com', 'https://user:password@example.com', '/a\nb']) assert.equal(supportedLink(href), false);
});

test('orders newest first and groups multiple same-day releases with deterministic slug order', () => {
  const entries = validateEntries([entry({slug: 'z'}), entry({slug: 'older', date: '2026-10-30'}), entry({slug: 'a'})]);
  const ordered = visibleEntries(entries);
  assert.deepEqual(ordered.map(e => e.slug), ['a', 'z', 'older']);
  assert.deepEqual(groupEntries(ordered).map(g => [g.date, g.entries.length]), [['2026-10-31', 2], ['2026-10-30', 1]]);
  assert.equal(formatReleaseDate('2026-10-31'), 'October 31, 2026');
});

test('uses publication sequence within a day before the slug fallback', () => {
  const entries = validateEntries([
    entry({slug: 'a-earlier', sequence: 1}),
    entry({slug: 'z-latest', sequence: 2}),
    entry({slug: 'older-day', date: '2026-10-30', sequence: 99}),
    entry({slug: 'legacy'}),
  ]);
  assert.deepEqual(visibleEntries(entries).map(e => e.slug), ['z-latest', 'a-earlier', 'legacy', 'older-day']);
  const dir = new URL('../content/changelog/', import.meta.url);
  const actual = validateEntries(readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
  assert.equal(visibleEntries(actual)[0].slug, 'oren-mcp-is-live');
  const published = findEntry(actual, 'transfer-stablecoins-and-stocks');
  assert.equal(published.status, 'published');
  assert.equal(published.date, '2026-11-03');
  assert.equal(published.title, 'Transfer stablecoins and stocks');
  assert.doesNotMatch(`${published.title} ${published.summary} ${JSON.stringify(published.sections)}`, /cash|withdraw/i);
});

test('the shared send-cash changelog URL redirects permanently to the transfer slug', () => {
  const config = readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8');
  assert.match(config, /source: "\/changelog\/send-cash-and-stocks", destination: "\/changelog\/transfer-stablecoins-and-stocks", permanent: true/);
});

test('draft lookup and listing require explicit development preview; production ignores the flag', () => {
  const entries = validateEntries([entry(), entry({slug: 'secret', status: 'draft'})]);
  for (const mode of ['production', 'test', undefined]) {
    const preview = draftsEnabled(mode, '1');
    assert.equal(preview, false);
    assert.deepEqual(visibleEntries(entries, preview).map(e => e.slug), ['release']);
    assert.equal(findEntry(entries, 'secret', preview), undefined);
  }
  assert.equal(draftsEnabled('development', '0'), false);
  assert.equal(draftsEnabled('development', undefined), false);
  assert.equal(findEntry(entries, 'secret', draftsEnabled('development', '1'))?.status, 'draft');
  assert.equal(findEntry(entries, 'missing'), undefined);
});

test('seed entry references the approved video and checksum manifest and explains development status', () => {
  const dir = new URL('../content/changelog/', import.meta.url);
  const entries = validateEntries(readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));
  const token = findEntry(entries, 'introducing-the-oren-token-page');
  assert.equal(token.date, '2026-10-31');
  assert.equal(token.video.src, '/videos/oren-token-explainer-50-percent.mp4');
  assert.match(token.video.caption, /in development and are not active yet/);
  assert.equal(token.links[0].href, '/token');
  const manifest = readFileSync(new URL('../../infra/videos.sha256', import.meta.url), 'utf8');
  assert.ok(manifest.includes(token.video.src.split('/').at(-1)));
  assert.ok(manifest.includes(token.video.poster.split('/').at(-1)));
});

function loadModule(file, require, process) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require, process });
  return exports;
}

test('real loader and route hide drafts from production params, metadata and page rendering', async () => {
  for (const nodeEnv of ['production', 'development']) {
    const data = loadModule('../content/changelog/index.ts', id => {
      if (id === 'server-only') return {};
      if (id === 'node:path') return {join: (...parts) => parts.join('/')};
      if (id === './model.mjs') return model;
      if (id === 'node:fs') return {
        readdirSync: () => ['published.json', 'draft.json'],
        readFileSync: path => JSON.stringify(entry(path.endsWith('/draft.json') ? {slug: 'secret', status: 'draft', title: 'Secret announcement'} : {})),
      };
      throw new Error(`Unexpected loader import ${id}`);
    }, {cwd: () => '/app', env: {NODE_ENV: nodeEnv, OREN_CHANGELOG_PREVIEW: '1'}});
    const route = loadModule('../app/changelog/[slug]/page.tsx', id => {
      if (id === '@/content/changelog') return data;
      if (id === '@/content/changelog/model.mjs') return model;
      if (id === 'next/navigation') return {notFound: () => {throw new Error('404');}};
      if (id === '@hugeicons/core-free-icons') return {};
      if (id === '@hugeicons/react') return {HugeiconsIcon: () => null};
      if (id === 'react/jsx-runtime') return {jsx: () => ({}), jsxs: () => ({})};
      if (id === 'next/link' || id.includes('changelog-entry') || id.endsWith('.css')) return {};
      throw new Error(`Unexpected route import ${id}`);
    });
    const props = slug => ({params: Promise.resolve({slug})});
    await assert.rejects(route.default(props('missing')), /404/);
    await assert.rejects(route.generateMetadata(props('missing')), /404/);
    assert.equal((await route.generateMetadata(props('release'))).alternates.canonical, '/changelog/release');
    if (nodeEnv === 'production') {
      assert.deepEqual(Array.from(route.generateStaticParams(), p => p.slug), ['release']);
      await assert.rejects(route.default(props('secret')), /404/);
      await assert.rejects(route.generateMetadata(props('secret')), /404/);
    } else {
      assert.equal(route.generateStaticParams().length, 2);
      const metadata = await route.generateMetadata(props('secret'));
      assert.equal(metadata.robots.index, false);
      assert.equal(metadata.title.includes('Secret announcement'), false);
      await route.default(props('secret'));
    }
  }
});
