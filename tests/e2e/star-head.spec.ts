import { devices, type Page } from '@playwright/test';
import { expect, test, testIp } from './fixtures';
import { asPlayer, game, pickName, ready, resumeIfPaused, signInFromChip, type W } from './helpers';

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
    await fresh.close();
  }
});
