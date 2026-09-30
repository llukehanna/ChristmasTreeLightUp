import { expect, test, type Page } from '@playwright/test';
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
async function tapTile(page: Page, i: number): Promise<void> {
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await page.mouse.click(x, y);
}

test('loads cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('fonts.g')) errors.push(m.text());
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

test('solving shows the results card and sharing copies to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined }));
  await ready(page);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#r-time')).toHaveText(/^Lit in \d+:\d\d$/);
  await page.click('#r-share');
  await expect(page.locator('#toast')).toHaveText(/copied/i);
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
