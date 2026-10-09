import { devices, type Page } from '@playwright/test';
import { expect, test, testIp } from './fixtures';
import { asPlayer, game, pickName, ready, resumeIfPaused, signInFromChip, stopClock, tapStarStill, waitInteractive, type W } from './helpers';

test.describe.configure({ timeout: 120_000 });

// The star's taps are made with the page's clock stopped (tapStarStill), so it is installed before every load.
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});

const star = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.star());
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('aglow.starHead'));
const board = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());

const touch = (): boolean => test.info().project.name === 'phone';

/** Taps the star like a person: a mouse click on desktop, a finger on the phone (quick ones, however loaded the machine). */
const tapStar = (page: Page, times: number) => tapStarStill(page, times, touch());

test('five quick taps on the star put the head on top, five more bring the star back; the board never sees them', async ({ page }) => {
  await ready(page);
  const before = await board(page);
  const log = (await game(page)).log;
  expect(await star(page)).toMatchObject({ head: false });

  await tapStarStill(page, 4, touch(), true); // the clock stays stopped: the fifth is as quick as the rest
  expect(await star(page)).toMatchObject({ head: false, taps: 4 });
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
  if (touch()) await page.touchscreen.tap(x, y);
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
  const [x, y] = (await star(page)).center;
  const tap = () => (touch() ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  // The page's clock stands still but for the pause, which is exactly 1.9 s of its time: a loaded machine can neither
  // stretch the quick taps apart nor shorten the pause.
  await stopClock(page);
  for (let k = 0; k < 4; k++) await tap();
  expect(await star(page)).toMatchObject({ head: false, taps: 4 });
  await page.clock.fastForward(1900);
  await tap();
  expect(await star(page)).toMatchObject({ head: false, taps: 1 }); // the count started over
  for (let k = 0; k < 4; k++) await tap(); // with the one after the pause: five in a row
  await page.clock.resume();
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
  // Two browsers and two sign-ins: on a loaded machine the body alone can take most of 120 s, before the teardown.
  test.slow();
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
  const phone = touch();
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
    // /api/me, then the sticker's load: on a loaded machine that can take longer than the default 5 s.
    await expect.poll(async () => (await star(other)).head, { timeout: 30_000 }).toBe(true);
    expect(await stored(other)).toBe('true');
  } finally {
    // A request still in our route handler (the radio's, say) would otherwise hold the close up.
    await fresh.unrouteAll({ behavior: 'ignoreErrors' });
    await fresh.close();
  }
});
