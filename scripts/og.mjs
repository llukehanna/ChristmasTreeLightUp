import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
for (let t = Date.now(); ; ) {
  try {
    if ((await fetch('http://localhost:4174/')).ok) break;
  } catch {}
  if (Date.now() - t > 20000) throw new Error('vite preview did not start on :4174');
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'fireside', pathStyle: 'filament', effectsVolume: 0, haptics: false }));
    localStorage.setItem('aglow.seenIntro', 'true');
  });
  await page.goto('http://localhost:4174/?test');
  await page.waitForFunction(() => window.__aglow?.state().interactive);
  await page.evaluate(() => window.__aglow.solve());
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    for (const id of ['results', 'toast', 'intro']) document.getElementById(id)?.remove();
    document.querySelector('.hud')?.remove();
  });
  await page.screenshot({ path: 'public/og.png' });
  console.log('wrote public/og.png');
} finally {
  await browser.close();
  server.kill();
}
