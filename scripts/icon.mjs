// Renders public/apple-touch-icon.png (180×180) from public/favicon.svg with Playwright's Chromium.
// iOS applies its own rounded mask and fills transparent pixels with black, so the tile is rendered full-bleed.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8').replace('rx="14" fill="url(#bgc)"', 'fill="url(#bgc)"');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await page.setContent(`<body style="margin:0"><img src="${src}" width="180" height="180" style="display:block"></body>`);
  await page.waitForFunction(() => document.querySelector('img')?.complete);
  await page.screenshot({ path: 'public/apple-touch-icon.png', clip: { x: 0, y: 0, width: 180, height: 180 } });
  console.log('wrote public/apple-touch-icon.png');
} finally {
  await browser.close();
}
