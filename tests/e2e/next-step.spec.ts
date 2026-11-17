import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { asPlayer, onlineTree, openAccount, pickName, ready, resumeIfPaused, signInFromMenu, solveByTapping, waitInteractive, type W } from './helpers';

// The tag's next step and the phone bottom-sheet menu (docs/superpowers/specs/2026-11-17-aglow-next-step-design.md).

const win = async (page: Page): Promise<void> => {
  await waitInteractive(page);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 15_000 });
};

/** A new day began during the session: this device's Daily mark is an old day's. */
const newDay = (page: Page) => page.evaluate(() => localStorage.setItem('aglow.daily', JSON.stringify('2000-01-01')));

test('the tag offers no next step once the Daily is played (outside Advent)', async ({ page }) => {
  test.skip(new Date().getMonth() === 11, 'Advent may offer catch-up doors');
  await ready(page);
  await win(page);
  await expect(page.locator('#results .next-row')).toHaveCount(0);
});

test("a new day's Daily: the tag offers it, and the row starts it", async ({ page }) => {
  test.skip(new Date().getMonth() === 11 && new Date().getDate() <= 24, "in Advent the row is today's door");
  await ready(page);
  await newDay(page);
  await win(page);
  const row = page.locator('#results .next-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.next-w')).toHaveText("Today's Daily Tree");
  await row.click();
  await expect(page.locator('#daily-pill')).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
});

for (const [width, height] of [[320, 568], [375, 812]] as const) {
  test(`with the row, Keep watching stays on a ${width}×${height} screen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    await newDay(page);
    await win(page);
    await expect(page.locator('#results .next-row')).toHaveCount(1);
    await page.waitForTimeout(1000); // the tag's rise
    const keep = await page.locator('#r-keep').boundingBox();
    expect(keep).not.toBeNull();
    expect(keep!.y + keep!.height).toBeLessThanOrEqual(height);
  });
}

test('on a 320×568 phone, a guest tag with the row stays clear of the HUD', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await ready(page);
  await onlineTree(page);
  await newDay(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  await expect(results.locator('.next-row')).toHaveCount(1);
  await page.waitForTimeout(1000); // the tag's rise
  const gap = await page.evaluate(() => document.getElementById('results')!.getBoundingClientRect().top - document.querySelector('.hud')!.getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(0);
});

test('in Advent, signing in from the tag brings the catch-up row (the tag comes back before the account does)', async ({ page }) => {
  // December 5, noon: doors 1–3 have closed everywhere, door 4 hasn't. This device has started today's Daily.
  await page.clock.setFixedTime(new Date(2026, 11, 5, 12));
  await page.addInitScript(() => localStorage.setItem('aglow.daily', JSON.stringify('2026-12-05')));
  const player = await asPlayer(page);
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  await expect(results.locator('.next-row')).toHaveCount(0); // a guest's doors can't open
  await results.getByRole('button', { name: 'Save to leaderboard' }).click();
  // Back from Google, /api/me answers after the tag is back up.
  let releaseMe = (): void => {};
  const meHeld = new Promise<void>((r) => (releaseMe = r));
  await page.route(
    (url) => url.pathname === '/api/me',
    async (route) => {
      await meHeld;
      await route.fallback();
    },
  );
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
  await expect(results).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  releaseMe();
  await pickName(page, player.name);
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.next-row .next-m')).toHaveText('3 to catch up');
});

const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
  }, sel);

test.describe('the menu on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('opens as a bottom sheet, the bow hidden', async ({ page }) => {
    await ready(page);
    await page.click('#menu-btn');
    await expect(page.locator('#menu')).toBeVisible();
    await page.waitForTimeout(450); // the slide-up
    const b = await box(page, '#menu');
    expect(Math.abs(b.bottom - 812)).toBeLessThanOrEqual(1);
    expect(b.left).toBe(0);
    expect(b.width).toBe(375);
    expect(b.top).toBeGreaterThan(100);
    await expect(page.locator('#menu .bow')).toBeHidden();
  });

  test('the account page it opens is a bottom sheet too, and ‹ Menu goes back to the sheet', async ({ page }) => {
    const player = await asPlayer(page);
    await ready(page);
    await signInFromMenu(page);
    await pickName(page, player.name);
    await resumeIfPaused(page);
    await openAccount(page);
    await expect(page.locator('.acct-drop')).toBeVisible();
    await page.waitForTimeout(450);
    const b = await box(page, '.acct-drop');
    expect(Math.abs(b.bottom - 812)).toBeLessThanOrEqual(1);
    expect(b.width).toBe(375);
    await page.click('.acct-drop .acct-back');
    await expect(page.locator('#menu')).toBeVisible();
  });

  test('a tap on the dimmed game closes the sheet and turns no tile', async ({ page }) => {
    await ready(page);
    await waitInteractive(page);
    const before = await page.evaluate(() => (window as unknown as W).__aglow.state().bits);
    await page.click('#menu-btn');
    await page.waitForTimeout(450);
    // The sheet is tall on a phone: the dimmed strip above it is stage, under the HUD.
    const top = (await box(page, '#menu')).top;
    expect(top).toBeGreaterThan(90);
    expect(await page.evaluate((y) => document.elementFromPoint(40, y)?.id, top - 12)).toBe('stage');
    await page.mouse.click(40, top - 12);
    await expect(page.locator('#menu')).toBeHidden();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as W).__aglow.state().bits)).toEqual(before);
  });
});

test('on a desktop the menu still drops from the top right', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await page.click('#menu-btn');
  await page.waitForTimeout(300);
  const b = await box(page, '#menu');
  expect(Math.abs(b.top - 66)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.right - 1252)).toBeLessThanOrEqual(1);
  await expect(page.locator('#menu .bow')).toBeVisible();
});
