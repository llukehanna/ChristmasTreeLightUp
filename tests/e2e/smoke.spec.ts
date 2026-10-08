import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { rotCW } from '../../src/core/dirs';
import type { AglowProbe } from '../../src/debug';

type W = Window & { __aglow: AglowProbe };

async function ready(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}
const state = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());
const middleTile = (page: Page) => page.evaluate(() => {
  const a = (window as unknown as W).__aglow;
  return a.ids[Math.floor(a.ids.length / 2)];
});
/** Two animation frames: lets the HUD catch up with a state change before it is read. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
async function tapTile(page: Page, i: number): Promise<void> {
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await page.mouse.click(x, y);
}

test('loads cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // A host without Plan 3's /api/stations answers 404 (the radio treats that as "no remote stations").
    const src = m.location().url;
    if (m.type() === 'error' && !m.text().includes('fonts.g') && !src.includes('/api/stations')) errors.push(m.text());
  });
  await ready(page);
  await expect(page.locator('.wordmark')).toHaveText(/aglow/i);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('tapping a tile turns it clockwise', async ({ page }) => {
  await ready(page);
  const tile = await middleTile(page);
  const before = await state(page);
  await tapTile(page, tile);
  await page.waitForTimeout(300);
  const after = await state(page);
  expect(after.bits[tile]).toBe(rotCW(before.bits[tile]));
});

test('zoomed in, the board draws under the camera and taps still hit the right tile', async ({ page }) => {
  await ready(page);
  // Record the scale of every bulb socket drawn on the stage (roundRect is only used for tile bulb sockets there;
  // the garland's sockets are pre-rendered off-screen).
  await page.evaluate(() => {
    const w = window as Window & { __rr?: number[] };
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.roundRect;
    proto.roundRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof orig>) {
      if (this.canvas.id === 'stage' && w.__rr) {
        const m = this.getTransform();
        w.__rr.push(Math.hypot(m.a, m.b));
      }
      return orig.apply(this, args);
    };
  });
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  await page.mouse.move(box.width / 2, box.height * 0.6);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -80);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoom-reset')).toBeVisible();
  await page.evaluate(() => ((window as Window & { __rr?: number[] }).__rr = []));
  await page.waitForTimeout(300);
  const scales = await page.evaluate(() => (window as Window & { __rr?: number[] }).__rr ?? []);
  expect(scales.length).toBeGreaterThan(0);
  // exp(0.8) ≈ 2.2× zoom at dpr 1: nothing on the board may be drawn at the unzoomed scale
  expect(Math.min(...scales)).toBeGreaterThan(1.8);

  const tile = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    const inView = a.ids.filter((i) => {
      const [x, y] = a.tileCenter(i);
      return x > 20 && y > 120 && x < innerWidth - 20 && y < innerHeight - 20;
    });
    return inView[Math.floor(inView.length / 2)];
  });
  const before = await state(page);
  await tapTile(page, tile);
  await page.waitForTimeout(300);
  expect((await state(page)).bits[tile]).toBe(rotCW(before.bits[tile]));
});

test('solving shows the results card and sharing copies to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined }));
  await ready(page);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#r-time')).toHaveText(/^Lit in \d+:\d\d$/);
  await page.click('#r-share');
  await expect(page.locator('#toast')).toHaveText(/image copied/i);
  // One clipboard item carries both the image and the share line (desktop paste targets pick what they accept).
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const text = await (await item.getType('text/plain')).text();
    return { types: [...item.types].sort(), text, png: (await item.getType('image/png')).size };
  });
  expect(clip.types).toEqual(['image/png', 'text/plain']);
  expect(clip.text).toMatch(/^Lit the tree in \d+:\d\d · aglow\.lukeghanna\.com$/);
  expect(clip.png).toBeGreaterThan(10_000);
  await page.click('#r-keep');
  await expect(page.locator('#corner-new')).toBeVisible();
});

test('settings persist across reloads', async ({ page }) => {
  await ready(page);
  await page.click('#menu-btn');
  await page.click('.seg[data-setting="pathStyle"] button[data-value="neon"]');
  await page.reload();
  await ready(page);
  await page.click('#menu-btn');
  await expect(page.locator('.seg[data-setting="pathStyle"] button[data-value="neon"]')).toHaveAttribute('aria-pressed', 'true');
});

test('an unfinished tree resumes after reload', async ({ page }) => {
  await ready(page);
  const tile = await middleTile(page);
  await tapTile(page, tile);
  await page.waitForTimeout(400);
  const before = await state(page);
  await page.reload();
  await ready(page);
  const after = await state(page);
  expect(after.bits).toEqual(before.bits);
  await expect(page.locator('#toast')).toHaveText(/welcome back/i);
});

test('a save made during the final turn resumes as a win', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const { solution } = (window as unknown as W).__aglow.state();
    const colors = solution.map(() => 0);
    localStorage.setItem('aglow.game', JSON.stringify({ v: 1, solution, bits: solution, colors, elapsedMs: 42_400 }));
  });
  await page.reload(); // not ready(): navigating again would start a fresh tree once the win has cleared the save
  await page.waitForFunction(() => !!(window as Window & { __aglow?: AglowProbe }).__aglow);
  expect((await state(page)).won).toBe(true);
  await expect(page.locator('#results')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#r-time')).toHaveText('Lit in 0:42');
  await expect(page.locator('#r-solved')).toHaveText('1');
  await expect(page.locator('#time')).toHaveText('0:42'); // the clock stays stopped
  expect(await page.evaluate(() => localStorage.getItem('aglow.game'))).toBeNull();
});

test('the settings dialog takes focus, closes on Escape and hands focus back', async ({ page }) => {
  await ready(page);
  await page.click('#menu-btn');
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('#menu'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#menu-btn')).toBeFocused();
  await expect(page.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'false');
});

test('the pause button stops the clock, and resuming continues it without turning a tile', async ({ page }) => {
  await ready(page);
  const time = page.locator('#time');
  const btn = page.locator('#pause-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-label', 'Pause');
  await expect(time).not.toHaveText('0:00', { timeout: 3000 });
  await btn.click();
  await expect(page.locator('#pause')).toBeVisible();
  await settle(page);
  await expect(page.locator('.hud')).toHaveJSProperty('inert', true); // controls under the overlay are out of reach
  const frozen = (await time.textContent()) ?? '';
  await page.waitForTimeout(1600);
  await expect(time).toHaveText(frozen);

  // Tapping the overlay over a tile resumes without turning that tile.
  const tile = await middleTile(page);
  const before = await state(page);
  await tapTile(page, tile);
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('.hud')).toHaveJSProperty('inert', false);
  await page.waitForTimeout(300);
  expect((await state(page)).bits[tile]).toBe(before.bits[tile]);
  await expect(time).not.toHaveText(frozen, { timeout: 3000 });

  // Keyboard: P pauses, Escape resumes.
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeVisible();
  await settle(page);
  const frozen2 = (await time.textContent()) ?? '';
  await page.waitForTimeout(1300);
  await expect(time).toHaveText(frozen2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await expect(time).not.toHaveText(frozen2, { timeout: 3000 });

  // Nothing to pause after the win.
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(btn).toBeHidden({ timeout: 4000 });
});
