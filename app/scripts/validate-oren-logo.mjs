/**
 * Extract outer shell silhouette from reference PNG and compare to SVG path.
 * Run: node scripts/validate-oren-logo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'public', 'oren-logo.png');
const outDir = path.join(root, 'scripts', 'logo-validation');

const CURRENT_OUTER =
  'M 51.37 11.59 C 53.16 11.61 54.93 11.66 56.74 11.82 C 58.54 11.97 60.39 12.18 62.21 12.5 C 64.04 12.82 65.91 13.18 67.69 13.76 C 69.48 14.33 71.29 15.01 72.95 15.92 C 74.6 16.84 76.18 17.98 77.63 19.24 C 79.07 20.49 80.46 21.94 81.62 23.46 C 82.78 24.98 83.69 26.69 84.59 28.37 C 85.48 30.04 86.13 31.79 86.99 33.5 C 87.84 35.22 88.57 36.93 89.73 38.64 C 90.89 40.35 92.43 41.88 93.95 43.78 C 95.47 45.68 97.89 47.85 98.86 50.06 C 99.83 52.26 100.1 54.79 99.77 57.02 C 99.45 59.25 98.27 61.49 96.92 63.41 C 95.57 65.33 93.3 66.93 91.67 68.55 C 90.03 70.17 88.51 71.56 87.1 73.12 C 85.69 74.68 84.53 76.35 83.22 77.91 C 81.91 79.47 80.73 81.15 79.22 82.48 C 77.72 83.81 76.01 85.05 74.2 85.9 C 72.39 86.76 70.34 87.23 68.38 87.61 C 66.42 87.99 64.38 88.07 62.44 88.18 C 60.5 88.3 58.58 88.26 56.74 88.3 C 54.89 88.34 53.16 88.39 51.37 88.41 C 49.58 88.43 47.83 88.43 46 88.41 C 44.18 88.39 42.29 88.38 40.41 88.3 C 38.53 88.22 36.66 88.17 34.7 87.96 C 32.74 87.75 30.59 87.61 28.65 87.04 C 26.71 86.47 24.73 85.65 23.06 84.53 C 21.39 83.41 20 81.79 18.61 80.31 C 17.22 78.82 16.02 77.21 14.73 75.63 C 13.43 74.05 12.39 72.41 10.84 70.83 C 9.3 69.25 7.08 67.9 5.48 66.15 C 3.88 64.4 2.15 62.44 1.26 60.33 C 0.36 58.22 -0.23 55.75 0.11 53.48 C 0.46 51.22 1.94 48.8 3.31 46.75 C 4.68 44.69 6.94 42.94 8.33 41.15 C 9.72 39.36 10.67 37.73 11.64 36.02 C 12.61 34.3 13.28 32.55 14.16 30.88 C 15.03 29.2 15.85 27.55 16.89 25.97 C 17.94 24.39 19.12 22.77 20.43 21.4 C 21.75 20.03 23.21 18.8 24.77 17.75 C 26.33 16.7 28.06 15.87 29.79 15.13 C 31.53 14.38 33.35 13.77 35.16 13.3 C 36.97 12.82 38.83 12.54 40.64 12.27 C 42.45 12.01 44.22 11.82 46 11.7 C 47.79 11.59 49.58 11.57 51.37 11.59 Z';

function samplePath(d, samples = 240) {
  // Browser-only normally; approximate by parsing M/C/Q commands for coarse check
  const nums = d.match(/-?\d+\.?\d*/g)?.map(Number) ?? [];
  const points = [];
  for (let i = 0; i < nums.length; i += 2) {
    if (nums[i + 1] !== undefined) points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Bounding box of bright glow pixels (shell ring)
  const threshold = 48;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const bright = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (a > 20 && lum > threshold) {
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

  const toNorm = (x, y) => ({
    x: Number(((x - cx) * scale + 50).toFixed(1)),
    y: Number(((y - cy) * scale + 50).toFixed(1)),
  });

  // Radial outer boundary samples
  const angles = 360;
  const contour = [];
  for (let a = 0; a < angles; a++) {
    const rad = (a / angles) * Math.PI * 2;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    let best = null;
    for (let step = 0; step < 700; step++) {
      const x = Math.round(cx + dx * step);
      const y = Math.round(cy + dy * step);
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      if (bright[y * width + x]) best = { x, y };
    }
    if (best) contour.push({ angle: a, ...toNorm(best.x, best.y) });
  }

  // Find ear extrema on left/right halves
  const left = contour.filter((p) => p.x < 48);
  const right = contour.filter((p) => p.x > 52);
  const leftEar = left.reduce((a, b) => (a.x < b.x ? a : b), left[0]);
  const rightEar = right.reduce((a, b) => (a.x > b.x ? a : b), right[0]);
  const top = contour.reduce((a, b) => (a.y < b.y ? a : b));
  const bottom = contour.reduce((a, b) => (a.y > b.y ? a : b));

  // Horizontal scan lines for side bulge profile
  const scanYs = [30, 35, 40, 45, 50, 55, 60, 65];
  const scans = scanYs.map((ny) => {
    const y = Math.round(cy + (ny - 50) / scale);
    let lx = null;
    let rx = null;
    for (let x = 0; x < width; x++) {
      if (bright[y * width + x]) {
        lx = x;
        break;
      }
    }
    for (let x = width - 1; x >= 0; x--) {
      if (bright[y * width + x]) {
        rx = x;
        break;
      }
    }
    return {
      y: ny,
      leftX: lx !== null ? toNorm(lx, y).x : null,
      rightX: rx !== null ? toNorm(rx, y).x : null,
      width: lx !== null && rx !== null ? toNorm(rx, y).x - toNorm(lx, y).x : null,
    };
  });

  const report = {
    bounds: { minX, minY, maxX, maxY, cx, cy, scale },
    extrema: { top, bottom, leftEar, rightEar },
    scans,
    contourSample: contour.filter((_, i) => i % 6 === 0),
  };

  fs.writeFileSync(path.join(outDir, 'reference-profile.json'), JSON.stringify(report, null, 2));

  // Render overlay SVG for visual diff
  const contourPoints = contour.map((p) => `${p.x},${p.y}`).join(' ');
  const currentPts = samplePath(CURRENT_OUTER)
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="600" height="600">
  <rect width="100" height="100" fill="#111"/>
  <polyline points="${contourPoints}" fill="none" stroke="#22c55e" stroke-width="0.6" opacity="0.9"/>
  <polyline points="${currentPts}" fill="none" stroke="#ef4444" stroke-width="0.5" stroke-dasharray="2 1" opacity="0.9"/>
  <circle cx="${leftEar.x}" cy="${leftEar.y}" r="1.2" fill="#22c55e"/>
  <circle cx="${rightEar.x}" cy="${rightEar.y}" r="1.2" fill="#22c55e"/>
  <text x="2" y="8" fill="#22c55e" font-size="4">green = reference PNG shell</text>
  <text x="2" y="13" fill="#ef4444" font-size="4">red dashed = current SVG</text>
  <text x="2" y="18" fill="#fff" font-size="3.2">L ear ${leftEar.x},${leftEar.y} | R ear ${rightEar.x},${rightEar.y}</text>
</svg>`;

  fs.writeFileSync(path.join(outDir, 'overlay.svg'), svg);

  // Raster overlay PNG
  await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, 'overlay.png'));

  console.log('Reference ear extrema (viewBox 0-100):');
  console.log('  Left:', leftEar);
  console.log('  Right:', rightEar);
  console.log('  Top:', top, ' Bottom:', bottom);
  console.log('\nHorizontal width profile:');
  for (const s of scans) {
    console.log(`  y=${s.y}: left=${s.leftX?.toFixed?.(1) ?? '?'} right=${s.rightX?.toFixed?.(1) ?? '?'} width=${s.width?.toFixed?.(1) ?? '?'}`);
  }
  console.log(`\nWrote ${path.join(outDir, 'overlay.svg')} and overlay.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
