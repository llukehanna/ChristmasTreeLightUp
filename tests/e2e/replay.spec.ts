import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { asPlayer, game, onlineTree, pickName, ready, resumeIfPaused, signInFromChip, solveByTapping, waitInteractive, type W } from './helpers';

// Each test signs a player in, solves a tree and watches it back: slow on a loaded machine.
test.describe.configure({ timeout: 150_000 });

const replay = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.replay());
const bar = (page: Page) => page.locator('#replay-bar');

/** Signs in as a new player with a name, on the random first tree, and resumes it. */
async function namedPlayer(page: Page): Promise<void> {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
}

/** Solves an online tree by tapping, and waits for the server's answer: the run is in the career. Returns its id. */
async function solvedRun(page: Page): Promise<string> {
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(() => game(page), { timeout: 20_000 }).toMatchObject({ id, outcome: 'done' });
  return id;
}

/** A new online tree, with three taps in its log (settled, so the tree is saved). */
async function treeInProgress(page: Page): Promise<string> {
  await page.evaluate(() => (window as unknown as W).__aglow.newTree());
  const id = await onlineTree(page);
  await page.evaluate(async () => {
    const a = (window as unknown as W).__aglow;
    for (const i of a.ids.slice(0, 3)) {
      a.tap(i);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await expect.poll(async () => (await game(page)).log).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__aglow.state().rotating)).toBe(0);
  return id;
}

const career = (page: Page) => page.getByRole('dialog', { name: 'Your career' });
/** Run `id`'s Watch button in the career page's log. */
const watchButton = (page: Page, id: string) => career(page).locator(`button.watch[data-id="${id}"]`);

/** Opens the career page from the account chip, and waits for run `id`'s Watch button. */
async function openCareer(page: Page, id: string): Promise<void> {
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Career' }).click();
  await expect(watchButton(page, id)).toBeEnabled();
}

/** Presses Watch on run `id`'s row in the open career page: the page goes, and the replay is on the stage. */
async function pressWatch(page: Page, id: string): Promise<void> {
  await watchButton(page, id).click();
  await expect(page.locator('body')).toHaveClass(/\bwatching\b/);
  await expect(career(page)).toBeHidden();
}

async function watchFromCareer(page: Page, id: string): Promise<void> {
  await openCareer(page, id);
  await pressWatch(page, id);
}

test('watch your own run from the career: the replay bar, the replay to its end, and Done back to the won tree', async ({ page }) => {
  await namedPlayer(page);
  const id = await solvedRun(page);
  await expect(page.locator('#results')).toBeVisible();
  await watchFromCareer(page, id);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.rb-cap')).toHaveText(/^Your run · \d+:\d\d\.\d$/);
  // The run's tag and HUD controls are set aside; the stage is the replay's.
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#pause-btn')).toBeHidden();
  expect(await replay(page)).toMatchObject({ watching: true });
  await expect.poll(async () => (await replay(page)).cursor).toBeGreaterThan(0);
  // 2× on.
  const fast = bar(page).getByRole('button', { name: '2×' });
  await fast.click();
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await replay(page)).ended, { timeout: 60_000 }).toBe(true);
  await expect(bar(page).getByRole('button', { name: 'Watch again' })).toBeVisible();
  // The bar fits a phone (375 px), its caption on a line of its own.
  const size = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 740 });
  const box = await bar(page).boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  if (size) await page.setViewportSize(size);
  await bar(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('body')).not.toHaveClass(/\bwatching\b/);
  await expect(bar(page)).toBeHidden();
  expect((await replay(page)).watching).toBe(false);
  // The won tree, with its results tag, exactly as it was.
  await expect(page.locator('#results')).toBeVisible();
  expect(await game(page)).toMatchObject({ id, outcome: 'done' });
  expect(await page.evaluate(() => (window as unknown as W).__aglow.state().won)).toBe(true);
});

test('watching mid-run costs only a pause: one p and one r in the log, and the time watching is not on the clock', async ({ page }) => {
  await namedPlayer(page);
  const earlier = await solvedRun(page);
  const id = await treeInProgress(page);
  // The career page pauses the tree as it opens; the time watching runs from the Watch press to Done.
  await openCareer(page, earlier);
  const t0 = await page.evaluate(() => performance.now());
  await pressWatch(page, earlier);
  await expect.poll(async () => (await replay(page)).ended, { timeout: 60_000 }).toBe(true);
  await bar(page).getByRole('button', { name: 'Done' }).click();
  const watched = (await page.evaluate(() => performance.now())) - t0;
  await expect(page.locator('body')).not.toHaveClass(/\bwatching\b/);
  // The tree is paused under the frost; resumed, it plays on to the win.
  await expect(page.locator('#pause')).toBeVisible();
  expect((await game(page)).id).toBe(id);
  await resumeIfPaused(page);
  // The wall time from the reveal's end to the win, read in the page as the win lands.
  await page.evaluate(() => {
    const w = window as unknown as W & { wonSince?: number };
    const tick = (): void => {
      if (w.__aglow.state().won) w.wonSince = w.__aglow.clock().sinceReveal;
      else setTimeout(tick, 5);
    };
    tick();
  });
  await solveByTapping(page);
  await expect.poll(() => game(page), { timeout: 20_000 }).toMatchObject({ id, outcome: 'done' });
  const wall = await page.evaluate(() => (window as unknown as { wonSince: number }).wonSince);
  const run = await page.evaluate(async (gameId) => {
    const r = await fetch(`/api/games/${encodeURIComponent(gameId)}/replay`);
    return (await r.json()) as { ms: number; log: { t: number; a: number | string }[] };
  }, id);
  expect(run.log.filter((e) => e.a === 'p')).toHaveLength(1);
  expect(run.log.filter((e) => e.a === 'r')).toHaveLength(1);
  expect(watched).toBeGreaterThan(1000);
  expect(run.ms).toBeLessThanOrEqual(wall - watched + 500);
});

test('a reload during a replay comes back to the player’s own tree, as it was before the watch', async ({ page }) => {
  await namedPlayer(page);
  const earlier = await solvedRun(page);
  const id = await treeInProgress(page);
  const before = await page.evaluate(() => {
    const s = (window as unknown as W).__aglow.state();
    return { bits: s.bits, litCount: s.litCount };
  });
  await watchFromCareer(page, earlier);
  await expect.poll(async () => (await replay(page)).cursor).toBeGreaterThan(1500);
  await page.reload();
  await waitInteractive(page);
  expect(await replay(page)).toMatchObject({ watching: false });
  await expect(page.locator('body')).not.toHaveClass(/\bwatching\b/);
  expect((await game(page)).id).toBe(id);
  const after = await page.evaluate(() => {
    const s = (window as unknown as W).__aglow.state();
    return { bits: s.bits, litCount: s.litCount, won: s.won };
  });
  expect(after).toEqual({ ...before, won: false });
});

test('keys while watching: Space and P play and pause, N does nothing, Escape is Done', async ({ page }) => {
  await namedPlayer(page);
  const id = await solvedRun(page);
  await watchFromCareer(page, id);
  const toggle = bar(page).locator('.rb-toggle');
  await expect(toggle).toHaveText('Pause');
  // From the game itself (focus on nothing), not a focused bar button.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(toggle).toHaveText('Play');
  const at = (await replay(page)).cursor;
  await page.waitForTimeout(400);
  expect((await replay(page)).cursor).toBe(at);
  await page.keyboard.press('p');
  await expect(toggle).toHaveText('Pause');
  await expect.poll(async () => (await replay(page)).cursor).toBeGreaterThan(at);
  await page.keyboard.press('n');
  await page.waitForTimeout(300);
  expect(await replay(page)).toMatchObject({ watching: true });
  expect((await game(page)).id).toBe(id);
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/\bwatching\b/);
  await expect(page.locator('#results')).toBeVisible();
});

test('the career opened over a replay pauses it, so it never plays out unseen; Play on the bar goes on from there', async ({ page }) => {
  await namedPlayer(page);
  // A slow solve, so the replay outlasts the clicks that open the page.
  const id = await onlineTree(page);
  await solveByTapping(page, 250);
  await expect.poll(() => game(page), { timeout: 20_000 }).toMatchObject({ id, outcome: 'done' });
  await watchFromCareer(page, id);
  const toggle = bar(page).locator('.rb-toggle');
  await expect(toggle).toHaveText('Pause');
  await openCareer(page, id);
  // The bar shows it paused, and the playhead stays where it stopped.
  await expect(toggle).toHaveText('Play');
  const at = (await replay(page)).cursor;
  await page.waitForTimeout(600);
  expect((await replay(page)).cursor).toBe(at);
  await page.keyboard.press('Escape');
  await expect(career(page)).toBeHidden();
  expect(await replay(page)).toMatchObject({ watching: true, ended: false });
  await expect(toggle).toHaveText('Play');
  await toggle.click();
  await expect(toggle).toHaveText('Pause');
  await expect.poll(async () => (await replay(page)).cursor).toBeGreaterThan(at);
});

test('a Watch still loading is cancelled by a resume or a new tree: the replay never takes over the tree in play', async ({ page }) => {
  await namedPlayer(page);
  const earlier = await solvedRun(page);
  // The replay route answers only when released.
  let release = (): void => undefined;
  const route = async () => {
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/api/games/*/replay', async (r) => {
      await held;
      await r.fallback();
    });
  };
  const notWatching = async () => {
    // Long enough for a released answer and the chunk to land.
    await page.waitForTimeout(1500);
    expect(await replay(page)).toMatchObject({ watching: false });
    await expect(page.locator('body')).not.toHaveClass(/\bwatching\b/);
  };

  // A resume: Watch on a tree in progress (the career page paused it), then the frost is tapped while the replay loads.
  await route();
  const id = await treeInProgress(page);
  await openCareer(page, earlier);
  await watchButton(page, earlier).click();
  await expect(page.locator('#toast')).toHaveText('Loading replay…');
  // The frost is tapped (not through resumeIfPaused, which waits out the fade: the toast's 2.2 s could end meanwhile).
  await page.locator('#pause').click();
  // The player is back in their run: "Loading replay…" goes with the Watch it belonged to.
  await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/, { timeout: 500 });
  await expect(page.locator('#pause')).toBeHidden();
  release();
  await notWatching();
  await expect(page.locator('#pause')).toBeHidden();
  expect((await game(page)).id).toBe(id);
  await page.unroute('**/api/games/*/replay');

  // A new tree: Watch, then a new tree starts while the replay loads, and the answer lands after it is up.
  await route();
  await openCareer(page, earlier);
  await watchButton(page, earlier).click();
  await page.evaluate(() => (window as unknown as W).__aglow.newTree());
  const fresh = await onlineTree(page);
  expect(fresh).not.toBe(id);
  release();
  await notWatching();
  await expect(page.locator('#pause')).toBeHidden();
  expect((await game(page)).id).toBe(fresh);
});

test.describe('racing your ghost', () => {
  test.use({ daily: true });

  const ghost = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.ghost());
  const pill = (page: Page) => page.locator('#ghost-pill');

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

  test("a guest's finished Daily is kept as their ghost even when a new tree starts before the finish answers", async ({ page }) => {
    await ready(page);
    const first = await dailyTree(page);
    // The finish answers only when released.
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/api/games/*/finish', async (r) => {
      await held;
      await r.fallback();
    });
    await solveByTapping(page);
    await page.evaluate(() => (window as unknown as W).__aglow.newTree());
    await expect.poll(async () => (await game(page)).id, { timeout: 20_000 }).not.toBe(first);
    release();
    // The answer lands for a tree the player has left; the day's ghost is kept all the same.
    await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('aglow.ghosts') ?? '{}')).length), { timeout: 20_000 }).toBe(1);
  });

  test("a Daily you've lit: the pill paces you with your ghost, G turns it off and on, the tag says how you did; a random tree has none", async ({ page }) => {
    await ready(page);
    const first = await dailyTree(page);
    // A first go has nothing to race.
    await expect(pill(page)).toBeHidden();
    await solveByTapping(page);
    await expect.poll(() => game(page), { timeout: 20_000 }).toMatchObject({ id: first, outcome: 'done' });
    // Solved as a guest: the device store holds it.
    const day = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('aglow.ghosts') ?? '{}')))).toEqual([day]);
    await expect(page.locator('#r-ghost')).toBeHidden();

    // The Daily again, from the menu: the ghost paces it.
    await page.click('#menu-btn');
    await page.click('#daily-row');
    await expect.poll(async () => (await game(page)).id, { timeout: 20_000 }).not.toBe(first);
    await waitInteractive(page);
    expect((await game(page)).id).not.toBeNull();
    await expect(pill(page)).toBeVisible();
    await expect(pill(page)).toHaveAttribute('aria-label', 'Race your ghost');
    await expect(pill(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(pill(page)).toHaveText(/^Ghost \d+%$/);
    const start = (await ghost(page)).text;
    expect(await ghost(page)).toMatchObject({ shown: true, on: true });
    await expect.poll(async () => (await ghost(page)).text, { timeout: 30_000 }).not.toBe(start);

    // A phone's HUD has no ghost pill (ruling R6): the HUD is as it was before the ghost, and G does nothing there.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 375, height: 740 });
    await expect(pill(page)).toBeHidden();
    expect(await pill(page).evaluate((p) => getComputedStyle(p).display)).toBe('none');
    // It takes no room: the HUD is as wide as with no ghost at all.
    const hudLeft = () => page.evaluate(() => document.querySelector('.hud')!.getBoundingClientRect().left);
    const withPill = await hudLeft();
    await pill(page).evaluate((p) => ((p as HTMLElement).hidden = true));
    expect(await hudLeft()).toBe(withPill);
    await pill(page).evaluate((p) => ((p as HTMLElement).hidden = false));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    expect((await ghost(page)).on).toBe(true);
    if (size) await page.setViewportSize(size);
    await expect(pill(page)).toBeVisible();

    // G turns it off and on again.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('g');
    await expect(pill(page)).toHaveText('Ghost');
    await expect(pill(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await ghost(page)).toMatchObject({ shown: true, on: false, text: 'Ghost' });
    await page.keyboard.press('g');
    await expect(pill(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(pill(page)).toHaveText(/^Ghost (\d+%|\d+:\d\d\.\d)$/);

    // Solving says how you did against it.
    await solveByTapping(page);
    await expect(page.locator('#r-ghost')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#r-ghost')).toHaveText(/^(\d+\.\d s (faster than|behind) your ghost|Level with your ghost)$/);

    // A random tree has no ghost.
    const second = (await game(page)).id;
    await page.evaluate(() => (window as unknown as W).__aglow.newTree());
    await expect.poll(async () => (await game(page)).id, { timeout: 20_000 }).not.toBe(second);
    await waitInteractive(page);
    await expect(pill(page)).toBeHidden();
    expect((await ghost(page)).shown).toBe(false);
  });
});
