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

/** Solves an online tree by tapping, and waits for the server's answer: the run is in Your games. Returns its id. */
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

/** Opens Your games from the account chip, and waits for run `id`'s Watch button. */
async function openGames(page: Page, id: string): Promise<void> {
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Your games' }).click();
  await expect(page.getByRole('dialog', { name: 'Your games' }).locator(`.acct-watch[data-id="${id}"]`)).toHaveAccessibleName('Watch replay');
}

/** Presses Watch on run `id`'s row in the open Your games sheet: the sheet goes, and the replay is on the stage. */
async function pressWatch(page: Page, id: string): Promise<void> {
  await page.getByRole('dialog', { name: 'Your games' }).locator(`.acct-watch[data-id="${id}"]`).click();
  await expect(page.locator('body')).toHaveClass(/\bwatching\b/);
  await expect(page.getByRole('dialog', { name: 'Your games' })).toBeHidden();
}

async function watchFromGames(page: Page, id: string): Promise<void> {
  await openGames(page, id);
  await pressWatch(page, id);
}

test('watch your own run from Your games: the replay bar, the replay to its end, and Done back to the won tree', async ({ page }) => {
  await namedPlayer(page);
  const id = await solvedRun(page);
  await expect(page.locator('#results')).toBeVisible();
  await watchFromGames(page, id);
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
  // The sheet pauses the tree as it opens; the time watching runs from the Watch press to Done.
  await openGames(page, earlier);
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
  await watchFromGames(page, earlier);
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
  await watchFromGames(page, id);
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
