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

test.describe('the Daily Tree', () => {
  test.use({ daily: true });

  /** The bodies of this page's POST /api/games, in order (across reloads). */
  const starts = (page: Page): unknown[] => {
    const bodies: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/games') bodies.push(r.postDataJSON());
    });
    return bodies;
  };
  /** The browser's local day (YYYY-MM-DD) and its label's date ("Nov 6"). */
  const today = (page: Page) =>
    page.evaluate(() => {
      const d = new Date();
      return {
        day: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    });
  /** The Daily from the server. A cold local Worker can miss the 1.5 s start; a failed start marks nothing, so a reload asks again. */
  async function dailyTree(page: Page): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitInteractive(page);
      const { id } = await game(page);
      if (id) return id;
      await page.reload();
    }
    throw new Error('the local Worker never started the Daily');
  }

  test('a first visit lands on the Daily Tree: the pill reads Daily Tree · <today>', async ({ page }) => {
    const bodies = starts(page);
    await ready(page);
    await dailyTree(page);
    const { day, label } = await today(page);
    expect(bodies.at(-1)).toEqual({ daily: { today: day } });
    await expect(page.locator('#daily-pill')).toBeVisible();
    await expect(page.locator('#daily-pill')).toHaveText(`Daily Tree · ${label}`);
    expect(await page.evaluate(() => localStorage.getItem('aglow.daily'))).toBe(JSON.stringify(day));
    // On a phone the pill reads Daily alone.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#daily-pill')).toHaveJSProperty('innerText', 'Daily');
  });

  test('after N the pill is gone', async ({ page }) => {
    const bodies = starts(page);
    await ready(page);
    await dailyTree(page);
    await expect(page.locator('#daily-pill')).toBeVisible();
    const sent = bodies.length;
    await page.keyboard.press('n');
    // Mid-run the first N only asks.
    if ((await page.locator('#toast').textContent())?.includes('Press N again')) await page.keyboard.press('n');
    await expect.poll(() => bodies.length).toBe(sent + 1);
    expect(bodies.at(-1)).toEqual({});
    await waitInteractive(page);
    await expect(page.locator('#daily-pill')).toBeHidden();
  });

  test('a reload mid-Daily resumes it, pill and all, with no second start request', async ({ page }) => {
    const bodies = starts(page);
    await ready(page);
    const id = await dailyTree(page);
    await page.evaluate(() => {
      const a = (window as unknown as W).__aglow;
      a.tap(a.ids[3]);
    });
    await page.waitForTimeout(300); // the turn settles and saves
    const sent = bodies.length;
    await page.reload();
    await waitInteractive(page);
    expect((await game(page)).id).toBe(id);
    await expect(page.locator('#daily-pill')).toHaveText(`Daily Tree · ${(await today(page)).label}`);
    await expect(page.locator('#daily-pill')).toBeVisible();
    await page.waitForTimeout(500);
    expect(bodies.length).toBe(sent);
  });

  test('reload before the first move on the Daily resumes it, pill and all, with no second start', async ({ page }) => {
    const bodies = starts(page);
    await ready(page);
    const id = await dailyTree(page);
    const sent = bodies.length;
    await page.reload();
    await waitInteractive(page);
    expect((await game(page)).id).toBe(id);
    await expect(page.locator('#daily-pill')).toBeVisible();
    await expect(page.locator('#daily-pill')).toHaveText(`Daily Tree · ${(await today(page)).label}`);
    await page.waitForTimeout(500);
    expect(bodies.length).toBe(sent);
    // The resumed log (a reload as its only pause) still verifies: a Daily first attempt, played signed out.
    await solveByTapping(page);
    await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'daily' });
  });

  test("the menu's Daily Tree row says Played once today's Daily is started", async ({ page }) => {
    await ready(page);
    await dailyTree(page);
    await page.click('#menu-btn');
    await expect(page.locator('#daily-row')).toBeVisible();
    await expect(page.locator('#daily-note')).toBeVisible();
    await expect(page.locator('#daily-note')).toHaveText('Played');
  });

  test('with /api/games failing, the tree is local with no pill, and the next load asks for the Daily again', async ({ page }) => {
    const bodies = starts(page);
    await page.route('**/api/games', (route) => route.abort());
    await ready(page);
    expect((await game(page)).id).toBeNull();
    await expect(page.locator('#daily-pill')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('aglow.daily'))).toBeNull();
    const { day } = await today(page);
    expect(bodies).toEqual([{ daily: { today: day } }]);
    await page.unroute('**/api/games');
    await page.reload();
    await dailyTree(page);
    expect(bodies[1]).toEqual({ daily: { today: day } });
    await expect(page.locator('#daily-pill')).toBeVisible();
  });
});
