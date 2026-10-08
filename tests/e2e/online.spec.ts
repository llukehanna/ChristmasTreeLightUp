import { expect, test } from '@playwright/test';
import { game, onlineTree, ready, solveByTapping, waitInteractive, type W } from './helpers';

test('a tree solved by tapping is replayed by the server and saved as an anonymous run', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous', ranked: false });
});

test('a lost finish response is retried once, so the run still saves', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/games/*/finish', (route) => (++attempts === 1 ? route.abort() : route.continue()));
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(async () => (await game(page)).outcome).toBe('done');
  expect(attempts).toBe(2);
});

test('when the server does not answer the start, the tree is local and unranked (offline)', async ({ page }) => {
  await page.route('**/api/games', (route) => route.abort());
  await ready(page);
  expect((await game(page)).id).toBeNull();
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect.poll(async () => (await game(page)).outcome).toBe('offline');
});

test('a reload mid-game resumes the same server game and logs the reload as a pause', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    a.tap(a.ids[3]);
  });
  await page.waitForTimeout(300);
  const before = (await game(page)).log;
  await page.reload();
  await waitInteractive(page);
  expect((await game(page)).id).toBe(id);
  await expect.poll(async () => (await game(page)).log).toBeGreaterThan(before);
});

test('a session with a pause, a hidden tab and a reload is verified by the server (the log matches its replay)', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  /** Taps tiles a.ids[from..to) to their solutions, like a person (60 ms apart). */
  const solveTiles = (from: number, to: number) =>
    page.evaluate(
      async ([f, t]) => {
        const a = (window as unknown as W).__aglow;
        // 90° clockwise: U→R, R→D, D→L, L→U (U=1, D=2, L=4, R=8).
        const rot = (b: number): number => (b & 1 ? 8 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 4 ? 1 : 0);
        const s = a.state();
        for (const i of a.ids.slice(f, t)) {
          for (let b = s.bits[i], k = 0; b !== s.solution[i] && k < 4; b = rot(b), k++) {
            a.tap(i);
            await new Promise((r) => setTimeout(r, 60));
          }
        }
      },
      [from, to],
    );
  const n = await page.evaluate(() => (window as unknown as W).__aglow.ids.length);
  const third = Math.floor(n / 3);
  await solveTiles(0, third);
  // P pauses, Escape resumes.
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeVisible();
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await solveTiles(third, 2 * third);
  // The tab is hidden (an automatic pause), comes back, and a tap on the overlay resumes.
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await expect(page.locator('#pause')).toBeVisible();
  await page.waitForTimeout(700);
  await setHidden(false);
  await page.locator('#pause').click();
  await page.waitForTimeout(500); // the last turns settle (and save)
  await page.reload();
  await waitInteractive(page);
  expect((await game(page)).id).toBe(id);
  await solveTiles(2 * third, n);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__aglow.state().won)).toBe(true);
  await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous', ranked: false });
});
