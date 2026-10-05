import { expect, test, type Page } from '@playwright/test';
import type { AglowProbe } from '../../src/debug';

type W = Window & { __aglow: AglowProbe };

async function ready(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());
/**
 * Pin the source (once: a reload keeps what the page saved). The auto scene's suggestion depends on the clock, and
 * Playwright's Chromium has no AAC; synth sources need no files.
 */
const pinSource = (page: Page, source: string) =>
  page.addInitScript((s) => {
    if (localStorage.getItem('aglow.radio') === null)
      localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: true, source: s, embedUrl: null, volume: 0.7, shuffle: true, lightShow: true }));
  }, source);
async function tapTile(page: Page): Promise<void> {
  const [x, y] = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.tileCenter(a.ids[40]);
  });
  await page.mouse.click(x, y);
}

test('the radio panel lists Music Box and Fireplace, and plays the Fireplace', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  const panel = page.locator('#radio-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#radio-pill')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('.stations')).toContainText('Music Box');
  await expect(panel.locator('.stations')).toContainText('Fireplace');
  // The preview build has no /api/stations: that is "no remote stations", not a failure, so no warning.
  await expect.poll(async () => (await radio(page)).stations).toEqual([]);
  await expect(panel.locator('.warn')).toBeHidden();
  await panel.locator('.st', { hasText: 'Fireplace' }).click();
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  await expect(page.locator('#radio-pill')).toContainText('Fireplace');
  await expect(panel.locator('.st', { hasText: 'Fireplace' })).toHaveAttribute('aria-current', 'true');
  await expect(panel.locator('.title')).toHaveText('Crackle & wind');
});

test('a failing stations endpoint shows the warning, and Music Box still plays', async ({ page }) => {
  await page.route('**/api/stations', (r) => r.fulfill({ status: 503, body: '' }));
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .warn')).toBeVisible();
  await page.locator('#radio-panel .st', { hasText: 'Music Box' }).click();
  await expect.poll(async () => (await radio(page)).kind).toBe('musicbox');
  await expect(page.locator('#radio-panel .credit')).toContainText('public domain, arranged for Aglow');
});

test('a Spotify playlist link becomes an embedded player; junk is rejected', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await page.click('#radio-panel .embed-row');
  const input = page.locator('#radio-panel .embed-input');
  await input.fill('not a link');
  await input.press('Enter');
  await expect(page.locator('#radio-panel .err')).toBeVisible();
  expect((await radio(page)).kind).not.toBe('embed');
  await input.fill('https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4?si=abc');
  await input.press('Enter');
  await expect(page.locator('#radio-panel .embed-frame iframe')).toHaveAttribute('src', /open\.spotify\.com\/embed\/playlist\/3rKFTakI4TxtuNLJ1Ruog4/);
  expect((await radio(page)).kind).toBe('embed');
  await expect(page.locator('#radio-panel .show')).toBeDisabled(); // embeds can't drive the light show
  // Switching away unmounts the embed.
  await page.locator('#radio-panel .st', { hasText: 'Fireplace' }).click();
  await expect(page.locator('#radio-panel .embed-frame iframe')).toHaveCount(0);
});

test('the first tile tap starts music, and the solved tree runs the light show', async ({ page }) => {
  await pinSource(page, 'music-box');
  await ready(page);
  expect((await radio(page)).playing).toBe(false);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).playing, { timeout: 5000 }).toBe(true);
  expect((await radio(page)).kind).toBe('musicbox');
  await expect(page.locator('#radio-pill')).toContainText('Music Box');
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect.poll(async () => (await radio(page)).lightShow).toBe(true);
});

test('muting from the panel is remembered across a reload', async ({ page }) => {
  await pinSource(page, 'fireplace');
  await ready(page);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).playing).toBe(true);
  await page.click('#radio-pill');
  await page.click('#radio-panel .play');
  await expect.poll(async () => (await radio(page)).playing).toBe(false);
  await expect(page.locator('#radio-pill')).toContainText('Music off');
  await ready(page);
  await tapTile(page);
  await page.waitForTimeout(500);
  expect((await radio(page)).playing).toBe(false);
  await expect(page.locator('#radio-pill')).toContainText('Music off');
});

test('Escape closes the radio panel and hands focus back to the pill', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('#radio-panel'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#radio-panel')).toBeHidden();
  await expect(page.locator('#radio-pill')).toBeFocused();
  await expect(page.locator('#radio-pill')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#pause')).toBeHidden(); // the Escape was the panel's, not the game's
});

test('P is ignored while the radio panel is open', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#pause-btn')).toBeVisible();
  await page.click('#radio-pill');
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('#radio-panel')).toBeVisible();
});

test('opening the radio closes the settings menu; a stage tap closes the radio without turning a tile', async ({ page }) => {
  await ready(page);
  await page.click('#menu-btn');
  await expect(page.locator('#menu')).toBeVisible();
  await page.click('#radio-pill');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#radio-panel')).toBeVisible();
  const before = await page.evaluate(() => (window as unknown as W).__aglow.state().bits);
  await tapTile(page);
  await expect(page.locator('#radio-panel')).toBeHidden();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as W).__aglow.state().bits)).toEqual(before);
});

test('while the game is paused the radio is out of reach', async ({ page }) => {
  await ready(page);
  await page.click('#pause-btn');
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('.hud')).toHaveJSProperty('inert', true);
  await expect(page.locator('#radio-panel')).toHaveJSProperty('inert', true);
  // Tab can't reach the pill inside the inert HUD.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('radio-pill');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('#radio-panel')).toHaveJSProperty('inert', false);
});
