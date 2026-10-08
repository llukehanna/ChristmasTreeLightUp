import type { Page } from '@playwright/test';
import { expect, test, testIp } from './fixtures';
import { game, onlineTree, ready, solveByTapping, waitInteractive, type W } from './helpers';

test('a tree solved by tapping is replayed by the server and saved as an anonymous run', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous', ranked: false });
  expect(await claimIds(page)).toEqual([id]);
});

test('each test reaches the Worker from its own client IP (the start limit counts per test)', async ({ page }) => {
  const sent = page.waitForRequest('**/api/games');
  await ready(page);
  expect((await (await sent).allHeaders())['cf-connecting-ip']).toBe(testIp(test.info()));
  expect(testIp({ testId: 'a', workerIndex: 0, retry: 0 })).not.toBe(testIp({ testId: 'b', workerIndex: 0, retry: 0 }));
});

/** The game ids this browser keeps claims for (aglow.claims). */
const claimIds = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.claims') ?? '[]') as { id: string }[]).map((c) => c.id));

test('a signed-out run is kept to claim even when a new tree starts before the finish answers', async ({ page }) => {
  let release = (): void => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/games/*/finish', async (route) => {
    await held;
    await route.fallback();
  });
  await ready(page);
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(async () => (await game(page)).outcome).toBe('saving');
  await page.evaluate(() => (window as unknown as W).__aglow.newTree());
  await expect.poll(async () => (await game(page)).id).not.toBe(id);
  release();
  await expect.poll(() => claimIds(page)).toEqual([id]);
});

test('an unranked signed-out run (too fast) is kept to claim too, so it reaches Your games after sign-in', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  // Every tap at once: far too fast to rank.
  await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    const rot = (b: number): number => (b & 1 ? 8 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 4 ? 1 : 0);
    const s = a.state();
    for (const i of a.ids) for (let b = s.bits[i], k = 0; b !== s.solution[i] && k < 4; b = rot(b), k++) a.tap(i);
  });
  await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'too_fast', ranked: false });
  expect(await claimIds(page)).toEqual([id]);
});

test('a log past 5,000 entries is never sent: the run is unverified on the spot', async ({ page }) => {
  let finishes = 0;
  await page.route('**/api/games/*/finish', (route) => {
    finishes++;
    return route.fallback();
  });
  await ready(page);
  await onlineTree(page);
  // Each burst turns every tile all the way round (one turn and three queued): four entries per tile, same tree after.
  for (let burst = 0; burst < 14; burst++) {
    await page.evaluate(() => {
      const a = (window as unknown as W).__aglow;
      for (const i of a.ids) for (let k = 0; k < 4; k++) a.tap(i);
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__aglow.state().rotating)).toBe(0);
  }
  expect((await game(page)).log).toBe(5000);
  await solveByTapping(page);
  await expect.poll(async () => (await game(page)).outcome).toBe('unverified');
  expect(finishes).toBe(0);
});

test('a lost finish response is retried once, so the run still saves', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/games/*/finish', (route) => (++attempts === 1 ? route.abort() : route.fallback()));
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
