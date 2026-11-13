/**
 * Fit smooth SVG path to reference PNG shell contour.
 * Run: node scripts/fit-oren-shell.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'public', 'oren-logo.png');

function catmullRomToBezier(points, closed = true) {
  const result = [];
  const n = points.length;
  const get = (i) => points[(i + n) % n];

  result.push(`M ${points[0].x} ${points[0].y}`);

  for (let i = 0; i < n; i++) {
    if (!closed && i === n - 1) break;
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    result.push(`C ${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }

  if (closed) result.push('Z');
  return result.join(' ');
}

function fmt(n) {
  return Number(n.toFixed(2));
}

function insetContour(points, inset = 11) {
  const cx = 50;
  const cy = 50;
  return points.map((p) => {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: p.x + (dx / len) * inset * 0.55,
      y: p.y + (dy / len) * inset * 0.55,
    };
  });
}

async function extractContour() {
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const threshold = 48;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const bright = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (data[i + 3] > 20 && lum > threshold) {
        bright[y * width + x] = 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 100 / Math.max(maxX - minX, maxY - minY);

  const contour = [];
  for (let a = 0; a < 360; a += 8) {
    const rad = (a / 360) * Math.PI * 2;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    let best = null;
    for (let step = 0; step < 700; step++) {
      const x = Math.round(cx + dx * step);
      const y = Math.round(cy + dy * step);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (bright[y * width + x]) best = { x, y };
    }
    if (best) {
      contour.push({
        x: ((best.x - cx) * scale + 50),
        y: ((best.y - cy) * scale + 50),
      });
    }
  }

  // Start path from top (min y)
  const startIdx = contour.reduce((best, p, i) => (p.y < contour[best].y ? i : best), 0);
  return [...contour.slice(startIdx), ...contour.slice(0, startIdx)];
}

const outerPts = await extractContour();
const innerPts = insetContour(outerPts, 12);
const outerPath = catmullRomToBezier(outerPts, true);
const innerPath = catmullRomToBezier(innerPts, true);

console.log('SHELL_OUTER =');
console.log(`  '${outerPath}';`);
console.log('\nSHELL_INNER =');
console.log(`  '${innerPath}';`);

const overlay = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="600" height="600">
  <rect width="100" height="100" fill="#111"/>
  <path d="${outerPath}" fill="none" stroke="#22c55e" stroke-width="0.5"/>
  <path d="${innerPath}" fill="none" stroke="#3b82f6" stroke-width="0.5"/>
  <path d="${outerPath} ${innerPath}" fill="#22c55e" fill-rule="evenodd" opacity="0.15"/>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'logo-validation', 'fitted.svg'), overlay);
console.log('\nWrote scripts/logo-validation/fitted.svg');
