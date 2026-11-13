import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import ts from 'typescript';

const imageUrl = new URL('../app/agents/opengraph-image.png', import.meta.url);
const altUrl = new URL('../app/agents/opengraph-image.alt.txt', import.meta.url);
const pageUrl = new URL('../app/agents/page.tsx', import.meta.url);

test('agents social image uses the pastoral artwork at the large-card size', async () => {
  const png = readFileSync(imageUrl);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length < 5 * 1024 * 1024);
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);

  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let samples = 0;
  let ink = 0;
  let grass = 0;
  let nearBlack = 0;
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const index = (y * width + x) * channels;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      samples += 1;
      if (red < 28 && green < 28 && blue < 28) nearBlack += 1;
      if (x < width * 0.42 && red < 70 && green < 75 && blue < 70) ink += 1;
      if (x > width * 0.68 && green > red + 6 && green > 80 && green < 200 && blue < green) grass += 1;
    }
  }
  assert.ok(ink > 30, `expected headline ink, found ${ink}`);
  assert.ok(grass > 40, `expected grass in the landscape, found ${grass}`);
  assert.ok(nearBlack / samples < 0.05, `image is mostly dark (${nearBlack}/${samples})`);

  const alt = readFileSync(altUrl, 'utf8');
  assert.equal(alt, 'Oren for AI agents: research, portfolio, and agent trading.');
  assert.equal(alt.includes('\n'), false);
});

test('agents metadata keeps the production canonical url and a large summary card', () => {
  const source = readFileSync(pageUrl, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
      if (id.endsWith('.css') || id === 'next/link' || id.startsWith('@/') || id.startsWith('@hugeicons') || id.startsWith('./')) return {};
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const { metadata } = exports;
  assert.equal(metadata.title, 'Connect your agent — Oren');
  assert.match(metadata.description, /Research stocks, understand your portfolio, and trade/);
  assert.match(metadata.description, /Claude, Cursor or Codex/);
  assert.equal(metadata.alternates.canonical, '/agents');
  assert.equal(metadata.openGraph.url, '/agents');
  assert.equal(metadata.openGraph.type, 'website');
  assert.equal(metadata.openGraph.title, metadata.title);
  assert.equal(metadata.openGraph.description, metadata.description);
  assert.equal(Object.hasOwn(metadata.openGraph, 'images'), false);
  assert.equal(metadata.twitter.card, 'summary_large_image');
  assert.equal(metadata.twitter.title, metadata.title);
  assert.equal(metadata.twitter.description, metadata.description);
  assert.equal(Object.hasOwn(metadata.twitter, 'images'), false);
});
