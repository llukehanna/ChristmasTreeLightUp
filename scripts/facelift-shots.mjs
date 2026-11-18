// The facelift's screenshot sweep: the HUD in play, the open
// menu, the account (a guest's sign-in sheet), the radio panel and the results tag, per scene, size and pixel density.
//   node scripts/facelift-shots.mjs [baseUrl] [outDir]
// baseUrl defaults to a dev server on :5181 (local only: the ?test probe). Shots are written to outDir, never the repo.
// Aurora is the secret scene: its chrome is checked by setting the scene on <body> over Fireside's stage.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5181';
const out = process.argv[3] ?? join(process.env.TMPDIR ?? '/tmp', 'aglow-facelift-shots');
mkdirSync(out, { recursive: true });

const SCENES = ['fireside', 'midnight', 'frost', 'aurora'];
const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 375, height: 812, isMobile: true, hasTouch: true },
];
const DPRS = [1, 2];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const browser = await chromium.launch({ headless: false });
for (const scene of SCENES) {
  for (const size of SIZES) {
    for (const dpr of DPRS) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: dpr, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch });
      const stage = scene === 'aurora' ? 'fireside' : scene;
      await context.addInitScript(([s, day]) => {
        localStorage.setItem('aglow.opened', 'true');
        localStorage.setItem('aglow.daily', JSON.stringify(day));
        const earned = [`scene:${s}`];
        localStorage.setItem('aglow.unlocks', JSON.stringify({ guest: { earned, known: earned, seen: earned, synced: false, treesLit: 0 } }));
        localStorage.setItem('aglow.look', JSON.stringify({ v: 1, scene: s }));
      }, [stage, today()]);
      const page = await context.newPage();
      await page.goto(`${base}/?test`);
      await page.waitForFunction(() => window.__aglow?.state().interactive, null, { timeout: 30_000 });
      if (scene === 'aurora') await page.evaluate(() => (document.body.dataset.scene = 'aurora'));
      const resume = async () => {
        for (let i = 0; i < 3 && (await page.evaluate(() => document.body.classList.contains('paused'))); i++) {
          await page.click('#pause');
          await page.waitForTimeout(700);
        }
      };
      const shot = async (step) => {
        await page.waitForTimeout(450);
        await page.screenshot({ path: join(out, `${scene}-${size.name}-${dpr}x-${step}.png`) });
      };
      await resume();
      await shot('1-play');
      await page.click('#menu-btn');
      await shot('2-menu');
      await page.click('#account-row');
      await shot('3-account');
      await page.keyboard.press('Escape');
      await resume();
      await page.click('#radio-pill');
      await shot('4-radio');
      await page.keyboard.press('Escape');
      await resume();
      await page.evaluate(() => window.__aglow.solve());
      await page.waitForSelector('#results.show', { timeout: 15_000 });
      await page.waitForTimeout(1200);
      await shot('5-win');
      await context.close();
      console.log(`${scene} ${size.name} ${dpr}x done`);
    }
  }
}
await browser.close();
console.log(`shots in ${out}`);
