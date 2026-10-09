import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ready, tapStarStill, type W } from './helpers';

test.describe.configure({ timeout: 120_000 });

// The star's five taps are made with the page's clock stopped (tapStarStill), so it is installed before every load.
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});

const secret = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.secret());
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());

/** Seconds of 8 kHz mono silence as a WAV: a track Playwright's Chromium can play (it has no AAC). */
function silentWav(seconds = 2, rate = 8000): Buffer {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}

const SECRET = {
  id: 'secret', name: 'Secret', description: '',
  tracks: [{ id: 's1', url: '/e2e-media/secret.wav', title: '12 Days of Christmas', artist: 'Gucci Mane', credit: '', duration: 2 }],
};

/** The station list (null: no endpoint, a 404) and its media, routed: no storage is touched. */
async function stations(page: Page, list: unknown[] | null): Promise<void> {
  await page.route('**/api/stations', (r) => (list === null ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ json: { version: 1, stations: list } })));
  await page.route('**/e2e-media/**', (r) => r.fulfill({ body: silentWav(), contentType: 'audio/wav' }));
}

/** Radio settings for the first load (a reload keeps what the page saved). */
const pinRadio = (page: Page, over: Record<string, unknown>) =>
  page.addInitScript((o) => {
    if (localStorage.getItem('aglow.radio') === null) {
      localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: true, source: null, embedUrl: null, volume: 0.7, lightShow: true, ...o }));
    }
  }, over);

/** Five quick clicks on the star (the page's clock stopped meanwhile; `keepStopped` leaves it so). */
const fiveTaps = (page: Page, keepStopped = false) => tapStarStill(page, 5, false, keepStopped);

async function tapTile(page: Page): Promise<void> {
  const [x, y] = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.tileCenter(a.ids[40]);
  });
  await page.mouse.click(x, y);
}

test('by hand: the aurora sweeps in, the Secret station is listed and plays, the faces are placed; off restores the Fireplace', async ({ page }) => {
  await stations(page, [SECRET]);
  await pinRadio(page, { source: 'fireplace' });
  await ready(page);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  const before = await secret(page);
  expect(before).toMatchObject({ on: false, faceTile: -1, faceGift: -1, faceGarland: -1 });
  expect(before.scene).not.toBe('aurora');
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .st[data-id="fireplace"]')).toBeVisible();
  await expect(page.locator('#radio-panel .st[data-id="secret"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // With the page's clock still stopped, the sweep has begun and can't have finished: it is caught under way.
  await fiveTaps(page, true);
  await expect.poll(async () => (await secret(page)).scene).toBe('aurora');
  expect(await secret(page)).toMatchObject({ on: true, sweeping: true });
  await page.clock.resume();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'aurora');
  await expect.poll(async () => (await radio(page)).source).toBe('secret');
  expect((await radio(page)).secretListed).toBe(true);
  await expect.poll(async () => (await secret(page)).sweeping).toBe(false);
  await expect.poll(async () => (await secret(page)).faceTile).toBeGreaterThanOrEqual(0);
  const on = await secret(page);
  expect(on.faceGift).toBeGreaterThanOrEqual(0);
  expect(on.faceGarland).toBeGreaterThanOrEqual(0);

  await page.click('#radio-pill');
  const row = page.locator('#radio-panel .st[data-id="secret"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Secret');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');

  await fiveTaps(page);
  await expect.poll(async () => (await secret(page)).scene).toBe(before.scene);
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  await expect.poll(async () => (await secret(page)).sweeping).toBe(false);
  expect(await secret(page)).toMatchObject({ on: false, faceTile: -1, faceGift: -1, faceGarland: -1 });
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .st[data-id="fireplace"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#radio-panel .st[data-id="secret"]')).toHaveCount(0);
});

test('with no Secret station, switching on plays the celesta, and switching off brings back the silence it found', async ({ page }) => {
  await stations(page, null);
  await ready(page);
  expect((await radio(page)).playing).toBe(false);
  await fiveTaps(page);
  await expect.poll(async () => (await radio(page)).kind).toBe('celesta');
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .st[data-id="secret"]')).toContainText('Dreamy celesta carols');
  await expect(page.locator('#radio-panel .station')).toHaveText('Secret');
  await page.keyboard.press('Escape');
  await fiveTaps(page);
  await expect.poll(async () => (await secret(page)).on).toBe(false);
  await expect.poll(async () => (await radio(page)).kind).toBeNull();
  expect((await radio(page)).playing).toBe(false);
});

test('a load in secret mode shows the aurora at once, with no sweep and no music; the first move starts the secret suggestion', async ({ page }) => {
  await stations(page, null);
  await page.addInitScript(() => localStorage.setItem('aglow.starHead', 'true'));
  await ready(page);
  expect(await secret(page)).toMatchObject({ on: true, scene: 'aurora', sweeping: false });
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'aurora');
  await expect.poll(async () => (await radio(page)).catalogLoaded).toBe(true);
  expect((await radio(page)).playing).toBe(false);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).kind).toBe('celesta');
});

/** The Secret station with a win ad-lib, and a count of the ad-lib's fetches. */
async function withAdlib(page: Page): Promise<{ fetched: () => number }> {
  await stations(page, [{ ...SECRET, winSound: '/e2e-media/win.wav' }]);
  let n = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/e2e-media/win.wav')) n++;
  });
  return { fetched: () => n };
}

const solve = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.solve());

test('a fresh win in secret mode plays the Secret station’s win ad-lib once, on the effects bus', async ({ page }) => {
  const adlib = await withAdlib(page);
  await ready(page);
  await fiveTaps(page);
  await expect.poll(async () => (await secret(page)).on).toBe(true);
  // Preloaded as secret mode turned on, so it is decoded well before the win.
  await expect.poll(adlib.fetched).toBeGreaterThan(0);
  await solve(page);
  await expect.poll(async () => (await secret(page)).adlibsPlayed, { timeout: 30_000 }).toBe(1);
  await expect(page.locator('#results')).toBeVisible();
  expect(await secret(page)).toMatchObject({ adlibsAsked: 1, adlibsPlayed: 1 });
});

test('with the effects volume at 0 the win ad-lib is never asked for', async ({ page }) => {
  await withAdlib(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.settings') === null) {
      localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'auto', pathStyle: 'filament', effectsVolume: 0, haptics: true }));
    }
  });
  await ready(page);
  await fiveTaps(page);
  await expect.poll(async () => (await secret(page)).on).toBe(true);
  await solve(page);
  // The tag comes 1.5 s after the chime, whose moment is when the ad-lib would be asked for.
  await expect(page.locator('#results')).toBeVisible({ timeout: 30_000 });
  expect(await secret(page)).toMatchObject({ adlibsAsked: 0, adlibsPlayed: 0 });
});

test('a muted radio: the world changes, the music does not', async ({ page }) => {
  await stations(page, [SECRET]);
  await pinRadio(page, { volume: 0 });
  await ready(page);
  await fiveTaps(page);
  await expect.poll(async () => (await secret(page)).scene).toBe('aurora');
  // The radio decides as the switch lands; the catalog, which a waiting start would follow, has arrived too.
  await expect.poll(async () => (await radio(page)).catalogLoaded).toBe(true);
  expect(await radio(page)).toMatchObject({ kind: null, playing: false, secretListed: true });
});
