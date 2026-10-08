import { devices, type Page } from '@playwright/test';
import { expect, test, testIp } from './fixtures';
import { asPlayer, game, pickName, ready, resumeIfPaused, signInFromChip, waitInteractive, type W } from './helpers';

test.describe.configure({ timeout: 120_000 });

const star = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.star());
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('aglow.starHead'));
const board = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());

/** Taps the star like a person: a mouse click on desktop, a finger on the phone. */
async function tapStar(page: Page, times: number): Promise<void> {
  const [x, y] = (await star(page)).center;
  for (let k = 0; k < times; k++) {
    if (test.info().project.name === 'phone') await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  }
}

test('five quick taps on the star put the head on top, five more bring the star back; the board never sees them', async ({ page }) => {
  await ready(page);
  const before = await board(page);
  const log = (await game(page)).log;
  expect(await star(page)).toMatchObject({ head: false });

  await tapStar(page, 4);
  expect((await star(page)).head).toBe(false);
  await tapStar(page, 1);
  await expect.poll(async () => (await star(page)).head).toBe(true);
  await expect(page.locator('#toast')).toHaveText('Ho ho ho.');
  expect(await stored(page)).toBe('true');

  await tapStar(page, 5);
  await expect.poll(async () => (await star(page)).head).toBe(false);
  await expect(page.locator('#toast')).toHaveText('Back to the star.');
  expect(await stored(page)).toBeNull();

  // Ten taps on the star: no tile turned, nothing logged.
  const after = await board(page);
  expect(after.bits).toEqual(before.bits);
  expect(after.rotating).toBe(0);
  expect((await game(page)).log).toBe(log);
});

/** The row-0 tile nearest the tree's axis: the one right under the star. */
async function tileUnderStar(page: Page): Promise<number> {
  return page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    const [sx] = a.star().center;
    const rowY = a.tileCenter(a.ids[0])[1];
    const row = a.ids.filter((i) => Math.abs(a.tileCenter(i)[1] - rowY) < 1);
    return row.reduce((best, i) => (Math.abs(a.tileCenter(i)[0] - sx) < Math.abs(a.tileCenter(best)[0] - sx) ? i : best));
  });
}

async function tapTile(page: Page, i: number): Promise<void> {
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  if (test.info().project.name === 'phone') await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

test('star taps during the reveal never start the clock, and the tile right under the star still turns', async ({ page }) => {
  await page.goto('/?test');
  await page.waitForFunction(() => !!(window as Window & { __aglow?: W['__aglow'] }).__aglow?.state().bits.length);
  await tapStar(page, 5);
  // The clock only ever runs from the reveal's end: star taps never start it early.
  const c = await page.evaluate(() => (window as unknown as W).__aglow.clock());
  expect(c.ms).toBeLessThanOrEqual(c.sinceReveal + 20);
  await expect.poll(async () => (await star(page)).head).toBe(true);
  await waitInteractive(page);
  const log = (await game(page)).log;
  const i = await tileUnderStar(page);
  const before = (await board(page)).bits[i];
  await tapTile(page, i);
  await expect.poll(async () => (await game(page)).log).toBe(log + 1);
  await expect.poll(async () => (await board(page)).bits[i]).not.toBe(before);
  expect((await star(page)).head).toBe(true);
});

test('zoomed in and panned, the star still takes its taps, and the tile under it is still a tile', async ({ page }) => {
  await ready(page);
  const [x, y] = (await star(page)).center;
  await page.evaluate(
    ([cx, cy]) => document.getElementById('stage')?.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -80, clientX: cx + 30, clientY: cy + 60, bubbles: true, cancelable: true })),
    [x, y],
  );
  await expect(page.locator('#zoom-reset')).toBeVisible();
  const zoomed = (await star(page)).center;
  expect(zoomed).not.toEqual([x, y]);
  const log = (await game(page)).log;
  await tapStar(page, 5);
  await expect.poll(async () => (await star(page)).head).toBe(true);
  expect((await game(page)).log).toBe(log);
  const i = await tileUnderStar(page);
  await tapTile(page, i);
  await expect.poll(async () => (await game(page)).log).toBe(log + 1);
});

test('a pause longer than 1.6 s between taps starts the count over', async ({ page }) => {
  await ready(page);
  await tapStar(page, 4);
  await page.waitForTimeout(1900);
  await tapStar(page, 1);
  await page.waitForTimeout(300);
  expect((await star(page)).head).toBe(false);
  await tapStar(page, 4); // with the one before the pause: five in a row
  await expect.poll(async () => (await star(page)).head).toBe(true);
});

test('the head stays after a reload (this browser keeps it)', async ({ page }) => {
  await ready(page);
  await tapStar(page, 5);
  await expect.poll(() => stored(page)).toBe('true');
  await ready(page);
  expect((await star(page)).head).toBe(true);
});

test('signed in, the head follows the account to a fresh browser', async ({ page, browser, baseURL }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/star-head') && r.request().method() === 'PUT');
  await tapStar(page, 5);
  expect((await saved).status()).toBe(200);
  await expect.poll(async () => (await star(page)).head).toBe(true);

  // Another browser: nothing stored locally, so the star until the same account signs in.
  const phone = test.info().project.name === 'phone';
  const fresh = await browser.newContext({ ...(phone ? devices['Pixel 7'] : devices['Desktop Chrome']), baseURL });
  try {
    const origin = new URL(baseURL ?? 'http://localhost:4173').origin;
    const ip = testIp(test.info());
    await fresh.route(
      (url) => url.origin === origin && url.pathname.startsWith('/api/'),
      (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }),
    );
    await fresh.addCookies([{ name: 'aglow_fake_as', value: player.email, url: origin }]);
    const other = await fresh.newPage();
    await ready(other);
    expect((await star(other)).head).toBe(false);
    await signInFromChip(other);
    await expect(other.locator('#account-chip')).toHaveAccessibleName(`Account: ${player.name}`);
    await expect.poll(async () => (await star(other)).head).toBe(true);
    expect(await stored(other)).toBe('true');
  } finally {
    // A request still in our route handler (the radio's, say) would otherwise hold the close up.
    await fresh.unrouteAll({ behavior: 'ignoreErrors' });
    await fresh.close();
  }
});
