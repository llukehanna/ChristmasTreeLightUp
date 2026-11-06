import type { Page } from '@playwright/test';
import { expect, test, testIp } from './fixtures';
import { asPlayer, game, onlineTree, pickName, ready, resumeIfPaused, signInFromChip, solveByTapping, waitInteractive, type W } from './helpers';

test('a tree solved by tapping is replayed by the server and saved as an anonymous run', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(() => game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous', ranked: false });
  expect(await claimIds(page)).toEqual([id]);
});

test('a fresh device lights its first tree: the tag says "Unlocked: Tinsel · Try it", and Try it puts tinsel on the tree', async ({ page }) => {
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const line = page.locator('#results .unlock');
  await expect(line).toHaveText('Unlocked: Tinsel · Try it');
  const look = () => page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.look') ?? '{}') as { decor?: { tinsel?: boolean } }).decor?.tinsel);
  expect(await look()).toBe(false);
  await line.getByRole('button', { name: 'Try it' }).click();
  await expect.poll(look).toBe(true);
  // Announced once: it is known now (aglow.unlocks), so the next tag won't say it again.
  const known = await page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.unlocks') ?? '{}') as Record<string, { known: string[] }>).guest?.known);
  expect(known).toContain('decor:tinsel');
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
  /** The Daily from the server. A cold local Worker can miss even the Daily's 5 s start; a failed start marks nothing, so a reload asks again. */
  async function dailyTree(page: Page): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitInteractive(page);
      const { id } = await game(page);
      if (id) return id;
      await page.reload();
    }
    throw new Error('the local Worker never started the Daily');
  }

  test("a returning visitor who hasn't started today's Daily lands on it: the pill reads Daily Tree · <today>", async ({ page }) => {
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

  test("the menu's Daily Tree row says Played once today's Daily is started, and on that Daily just closes the menu", async ({ page }) => {
    const bodies = starts(page);
    await ready(page);
    const id = await dailyTree(page);
    await page.click('#menu-btn');
    await expect(page.locator('#daily-row')).toBeVisible();
    await expect(page.locator('#daily-note')).toBeVisible();
    await expect(page.locator('#daily-note')).toHaveText('Played');
    const sent = bodies.length;
    await page.click('#daily-row');
    await expect(page.locator('#menu')).toBeHidden();
    await page.waitForTimeout(400);
    expect(bodies.length).toBe(sent);
    expect((await game(page)).id).toBe(id);
  });

  test('a pause before the first move on the Daily survives a reload: the time away is never ranked play', async ({ page }) => {
    const WAIT_MS = 8000;
    await ready(page);
    const id = await dailyTree(page);
    await page.keyboard.press('p');
    await expect(page.locator('#pause')).toBeVisible();
    // The pause is saved at once, before any move.
    const savedLog = () => page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as { log?: { a: unknown }[] }).log ?? []);
    expect((await savedLog()).map((e) => e.a)).toEqual(['p']);
    await page.waitForTimeout(WAIT_MS);
    await page.reload();
    await waitInteractive(page);
    expect((await game(page)).id).toBe(id);
    expect((await savedLog()).map((e) => e.a)[0]).toBe('p');
    const finish = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/games\/[^/]+\/finish$/.test(new URL(r.url()).pathname));
    const solveFrom = Date.now();
    await solveByTapping(page);
    const solvedIn = Date.now() - solveFrom;
    const result = (await (await finish).json()) as { ms: number; reason: string | null };
    expect(result.reason).toBe('daily');
    // Only the play after the reload is on the clock (plus the moment before the P), never the 8 s away.
    expect(result.ms).toBeLessThan(solvedIn + 2000);
  });

  test('a Daily start answered after 3 s still lands on the Daily: it waits longer than a random start', async ({ page }) => {
    const bodies = starts(page);
    await page.route('**/api/games', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.fallback();
    });
    await ready(page);
    expect((await game(page)).id).not.toBeNull();
    await expect(page.locator('#daily-pill')).toBeVisible();
    expect(bodies).toEqual([{ daily: { today: (await today(page)).day } }]);
    await expect(page.locator('#toast')).not.toHaveText("Couldn't reach the Daily Tree · playing a random one");
  });

  test('a Daily begun in a hidden tab logs the time unseen as a pause: the ranked time is only the time played', async ({ page }) => {
    const HIDDEN_MS = 6000;
    // A tab loaded in the background: hidden from the start, and no frames until it is shown (as a browser does).
    await page.addInitScript(() => {
      let hidden = true;
      const held: FrameRequestCallback[] = [];
      const raf = window.requestAnimationFrame.bind(window);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      window.requestAnimationFrame = (cb) => (hidden ? (held.push(cb), 0) : raf(cb));
      (window as unknown as { __show: () => void }).__show = () => {
        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        for (const cb of held.splice(0)) raf(cb);
      };
    });
    await page.goto('/?test');
    await expect.poll(async () => (await game(page)).id, { timeout: 10_000 }).not.toBeNull();
    const id = (await game(page)).id;
    // Marked away the instant it began, and saved (a Daily is saved from its start).
    const savedLog = () => page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as { log?: { a: unknown }[] }).log ?? []);
    await expect.poll(async () => (await savedLog()).map((e) => e.a)).toEqual(['p']);
    await page.waitForTimeout(HIDDEN_MS);
    await page.evaluate(() => (window as unknown as { __show: () => void }).__show());
    await waitInteractive(page);
    expect((await game(page)).id).toBe(id);
    const finish = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/games\/[^/]+\/finish$/.test(new URL(r.url()).pathname));
    const solveFrom = Date.now();
    await solveByTapping(page);
    const solvedIn = Date.now() - solveFrom;
    const result = (await (await finish).json()) as { ms: number; reason: string | null };
    expect(result.reason).toBe('daily');
    // The time on the clock is the play after the tab was shown, never the 6 s unseen.
    expect(result.ms).toBeLessThan(solvedIn + 2000);
  });

  test('with /api/games failing, the tree is local with no pill, and the next load asks for the Daily again', async ({ page }) => {
    const bodies = starts(page);
    await page.route('**/api/games', (route) => route.abort());
    await ready(page);
    expect((await game(page)).id).toBeNull();
    await expect(page.locator('#daily-pill')).toBeHidden();
    // The player is told: the Daily wasn't reached, and this tree is a random one.
    await expect(page.locator('#toast')).toHaveText("Couldn't reach the Daily Tree · playing a random one");
    expect(await page.evaluate(() => localStorage.getItem('aglow.daily'))).toBeNull();
    const { day } = await today(page);
    expect(bodies).toEqual([{ daily: { today: day } }]);
    await page.unroute('**/api/games');
    await page.reload();
    await dailyTree(page);
    expect(bodies[1]).toEqual({ daily: { today: day } });
    await expect(page.locator('#daily-pill')).toBeVisible();
  });

  test("solving the Daily shows its place on the Daily board on the tag", async ({ page }) => {
    test.setTimeout(120_000);
    const player = await asPlayer(page);
    await ready(page);
    await dailyTree(page);
    const { label } = await today(page);
    await solveByTapping(page);
    const results = page.locator('#results');
    await expect(results).toBeVisible({ timeout: 15_000 });
    // The tag names the tree above the time.
    await expect(results.locator('#r-daily')).toBeVisible();
    await expect(results.locator('#r-daily')).toHaveText(`Daily Tree · ${label}`);
    await expect(results.locator('#r-daily + #r-time')).toHaveText(/^Lit in \d+:\d\d$/);
    // Signed out: the place it would take on the Daily board, and a ribbon to save it there.
    await expect(results.locator('.rib-line')).toHaveText(/^Would place #\d+ of [\d,]+ on the Daily board$/, { timeout: 15_000 });
    await results.getByRole('button', { name: 'Save to the Daily board' }).click();
    await page.getByRole('dialog', { name: 'Sign in' }).getByRole('link', { name: 'Continue with Google' }).click();
    await page.waitForURL(/\/\?test$/);
    await pickName(page, player.name);
    // Claimed: the run's place on the Daily board, and its rosette opens that board.
    await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ on the Daily board$/, { timeout: 15_000 });
    await expect(results.locator('.rib-ribbon')).toHaveCount(0);
    await results.getByRole('button', { name: /^Rank \d+ of \d+ on the Daily board: open the leaderboard$/ }).click();
    const board = page.getByRole('dialog', { name: 'Leaderboard' });
    await expect(board.getByRole('group', { name: 'Time window' }).getByRole('button', { name: 'Daily', pressed: true })).toBeVisible();
    await expect(board.locator('.acct-me .acct-nm').first()).toHaveText(player.name);
    expect(await page.evaluate(() => localStorage.getItem('aglow.boardWindow'))).toBeNull();
  });
});

test.describe('the Daily Tree on a first visit', () => {
  test.use({ daily: true, firstVisit: true });

  test('the opening plays, then the room lands on the Daily Tree, its pill up', async ({ page }) => {
    const bodies: unknown[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/games') bodies.push(r.postDataJSON());
    });
    await page.goto('/?test');
    await expect(page.locator('body')).toHaveClass(/\bm-open\b/);
    expect(bodies).toEqual([]); // nothing asked for in the dark
    await waitInteractive(page);
    await expect(page.locator('body')).not.toHaveClass(/\bm-open\b/, { timeout: 15_000 });
    const day = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    expect(bodies[0]).toEqual({ daily: { today: day } });
    // A cold local Worker can miss the 1.5 s start: then the tree is local, with no pill (and the Daily is not marked).
    if ((await game(page)).id === null) {
      await expect(page.locator('#daily-pill')).toBeHidden();
      test.info().annotations.push({ type: 'note', description: 'cold Worker: the start missed its 1.5 s' });
      return;
    }
    const label = await page.evaluate(() => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    await expect(page.locator('#daily-pill')).toBeVisible();
    await expect(page.locator('#daily-pill')).toHaveText(`Daily Tree · ${label}`);
  });
});

test.describe('the Daily Tree from the menu, signed in', () => {
  test.describe.configure({ timeout: 120_000 });

  /** Signs in as a new player with a name, on the random first tree. */
  async function namedPlayer(page: Page): Promise<string> {
    const player = await asPlayer(page);
    await ready(page);
    await signInFromChip(page);
    await pickName(page, player.name);
    await resumeIfPaused(page);
    return player.name;
  }
  /** The menu's Daily Tree row (pressed again when a run in progress arms it), then the Daily the server started. */
  async function dailyFromMenu(page: Page): Promise<string> {
    const before = (await game(page)).id;
    await resumeIfPaused(page);
    await page.click('#menu-btn');
    await expect(page.locator('#daily-row')).toBeVisible();
    // Both presses in one task: on a loaded machine the 3 s confirm window can't lapse between them.
    await page.evaluate(() => {
      const row = document.getElementById('daily-row');
      row?.click();
      if (row?.classList.contains('armed')) row.click();
    });
    await expect.poll(async () => (await game(page)).id, { timeout: 10_000 }).not.toBe(before);
    await waitInteractive(page);
    await expect(page.locator('#daily-pill')).toBeVisible();
    return (await game(page)).id ?? '';
  }

  test("the board sheet's Daily window lists the run", async ({ page }) => {
    const name = await namedPlayer(page);
    await dailyFromMenu(page);
    await solveByTapping(page);
    const results = page.locator('#results');
    await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ on the Daily board$/, { timeout: 15_000 });
    await page.locator('#account-chip').click();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
    const board = page.getByRole('dialog', { name: 'Leaderboard' });
    const windows = board.getByRole('group', { name: 'Time window' });
    await expect(windows.getByRole('button').first()).toHaveText('Daily');
    // The remembered window is still Today until another is chosen.
    await expect(windows.getByRole('button', { name: 'Today', pressed: true })).toBeVisible();
    await windows.getByRole('button', { name: 'Daily' }).click();
    await expect(windows.getByRole('button', { name: 'Daily', pressed: true })).toBeFocused();
    const label = await page.evaluate(() => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    // The sub names the day it shows, as the pill does.
    await expect(board.locator('.acct-sub')).toHaveText(new RegExp(`^Daily Tree · ${label} · [\\d,]+ runs?$`));
    await expect(board.locator('.acct-me .acct-nm').first()).toHaveText(name);
    await expect(board.locator('.acct-pin-note')).toHaveText(/^Your run · #\d+ of [\d,]+$/);
    expect(await page.evaluate(() => localStorage.getItem('aglow.boardWindow'))).toBe('daily');
    // Your games: the run carries its Daily tag, and no "Unranked".
    await board.getByRole('tab', { name: 'Your games' }).click();
    const first = page.getByRole('dialog', { name: 'Your games' }).locator('.acct-game').first();
    await expect(first.locator('.acct-daily')).toHaveText(`Daily Tree · ${label}`);
    await expect(first).not.toContainText('Unranked');
  });

  test('a second Daily from the menu is unranked: not your first go', async ({ page }) => {
    await namedPlayer(page);
    await dailyFromMenu(page);
    await solveByTapping(page);
    const results = page.locator('#results');
    await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ on the Daily board$/, { timeout: 15_000 });
    // The tag is up: the Daily row starts the day's tree again, and says up front that it won't rank.
    await dailyFromMenu(page);
    await expect(page.locator('#toast')).toHaveText("Not your first go today · this one won't rank");
    await solveByTapping(page);
    await expect(results.locator('.rib-line')).toHaveText('Unranked: not your first go', { timeout: 15_000 });
    await expect(results.getByRole('img', { name: 'Unranked' })).toBeVisible();
    await expect(results.locator('.rib-ribbon')).toHaveCount(0);
    // Your games: the repeat says so, the first attempt doesn't.
    await page.locator('#account-chip').click();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Your games' }).click();
    const games = page.getByRole('dialog', { name: 'Your games' }).locator('.acct-game');
    await expect(games).toHaveCount(2);
    await expect(games.nth(0).locator('.acct-status')).toHaveText('Unranked · not your first go');
    await expect(games.nth(1).locator('.acct-status')).toHaveCount(0);
    await expect(games.nth(1).locator('.acct-daily')).toBeVisible();
  });

  test('Your games rows fit the sheet at 320px and on a desktop, a repeat Daily row and its long reason included', async ({ page }) => {
    await namedPlayer(page);
    for (let k = 0; k < 2; k++) {
      await dailyFromMenu(page);
      await solveByTapping(page);
      await expect(page.locator('#results .rib-line')).toHaveText(k ? 'Unranked: not your first go' : /^#\d+ of [\d,]+ on the Daily board$/, { timeout: 15_000 });
    }
    await page.locator('#account-chip').click();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Your games' }).click();
    const sheet = page.getByRole('dialog', { name: 'Your games' });
    const games = sheet.locator('.acct-game');
    await expect(games).toHaveCount(2);
    await expect(games.nth(0).locator('.acct-status')).toHaveText('Unranked · not your first go');
    /** The body never scrolls sideways, and every row's date, tag and status lie inside it. */
    const fits = () =>
      sheet.locator('.acct-body').evaluate((body) => {
        const box = body.getBoundingClientRect();
        const inside = [...body.querySelectorAll('.acct-game, .acct-when, .acct-daily, .acct-status')].every((n) => {
          const r = n.getBoundingClientRect();
          return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
        });
        return { scroll: body.scrollWidth, client: body.clientWidth, inside };
      });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(fits).toMatchObject({ inside: true });
      const { scroll, client } = await fits();
      expect(scroll, `at ${width}px`).toBeLessThanOrEqual(client);
    }
  });
});
