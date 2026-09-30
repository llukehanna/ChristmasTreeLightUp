// Renders the PNG icons from public/favicon.svg with Playwright's Chromium:
// - public/apple-touch-icon.png (180×180). iOS applies its own rounded mask and fills transparent pixels with black,
//   so the tile is rendered full-bleed.
// - public/favicon-32.png (32×32), the fallback for browsers without SVG favicons. Rounded corners, transparent outside.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync('public/favicon.svg', 'utf8');
// Drop the rounding on the background tile (the first <rect> with an rx).
const tile = /(<rect\b[^>]*?)\s+rx="[^"]*"/;
if (!tile.test(source)) throw new Error('icon: no rounded background <rect rx="…"> found in public/favicon.svg');

async function render(browser, svg, size, path, transparent) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await page.setContent(`<body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.waitForFunction(() => document.querySelector('img')?.complete);
  await page.screenshot({ path, clip: { x: 0, y: 0, width: size, height: size }, omitBackground: transparent });
  await page.close();
  console.log(`wrote ${path}`);
}

const browser = await chromium.launch();
try {
  await render(browser, source.replace(tile, '$1'), 180, 'public/apple-touch-icon.png', false);
  await render(browser, source, 32, 'public/favicon-32.png', true);
} finally {
  await browser.close();
}
