import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { asPlayer, game, onlineTree, pickName, ready, resumeIfPaused, signInFromChip, solveByTapping, type W } from './helpers';

// Each test signs a player in and most solve a tree: slow on a loaded machine.
test.describe.configure({ timeout: 150_000 });

const clockMs = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.clock().ms);
const frames = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state().frames);
const watching = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.replay().watching);
const careerState = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.career());
const careerPage = (page: Page) => page.getByRole('dialog', { name: 'Your career' });

/** Signs in as a new player with a name, on the random first tree, and resumes it. */
async function namedPlayer(page: Page): Promise<void> {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
}

/** Solves an online tree by tapping, and waits for the server's answer. Returns its id. */
async function solvedRun(page: Page): Promise<string> {
  const id = await onlineTree(page);
  await solveByTapping(page);
  await expect.poll(() => game(page), { timeout: 20_000 }).toMatchObject({ id, outcome: 'done' });
  return id;
}

/** The account menu's Career: the page is up. */
async function openCareer(page: Page): Promise<void> {
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Career' }).click();
  await expect(careerPage(page)).toBeVisible();
  await expect.poll(() => careerState(page)).toEqual({ open: true, loading: false });
}

test('a player opens Career from the menu', async ({ page }) => {
  await namedPlayer(page);
  await solvedRun(page);
  await page.locator('#r-new').click();
  await solvedRun(page);
  await openCareer(page);
  const career = careerPage(page);
  await expect(career.getByRole('heading', { name: 'Your career', level: 1 })).toBeVisible();
  const rows = career.locator('#career-log tbody tr');
  await expect(rows).toHaveCount(2);
  // Each row has its turns and its extra turns (the server's replay of the log counted them).
  for (let k = 0; k < 2; k++) {
    const cells = rows.nth(k).locator('td');
    await expect(cells.nth(3)).toHaveText(/^\d+$/);
    await expect(cells.nth(5)).toHaveText(/^\d+$/);
  }
});

test('Career mid-run pauses the clock, and Back closes it', async ({ page }) => {
  await namedPlayer(page);
  await onlineTree(page);
  await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    a.tap(a.ids[0]);
  });
  await expect.poll(() => clockMs(page)).toBeGreaterThan(0);
  const url = page.url();
  await openCareer(page);
  // The clock stands still and the stage draws nothing while the page is up.
  const clock = await clockMs(page);
  const drawn = await frames(page);
  await page.waitForTimeout(1000);
  expect(await clockMs(page)).toBe(clock);
  expect(await frames(page)).toBe(drawn);
  // Browser Back closes the page, not the site; the run is paused under the frost.
  await page.goBack();
  await expect(careerPage(page)).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(page.locator('#pause')).toBeVisible();
  expect(await careerState(page)).toEqual({ open: false, loading: false });
  // The stage draws again.
  await expect.poll(() => frames(page)).toBeGreaterThan(drawn);
});

test('a reveal that ends under Career pauses the run at its end: the covered time is not on the server either', async ({ page }) => {
  await namedPlayer(page);
  // Once, so its chunk is in: the page then lands at once, well inside the next tree's reveal.
  await openCareer(page);
  await page.keyboard.press('Escape');
  await expect(careerPage(page)).toBeHidden();
  const before = (await game(page)).id;
  // A new tree, and Career over it in the same task: the seed, the reveal and its end all come under the page.
  await page.evaluate(() => {
    (window as unknown as W).__aglow.newTree();
    document.getElementById('account-chip')?.click();
    document.querySelector<HTMLElement>('#account-menu [data-act="career"]')?.click();
  });
  await expect(careerPage(page)).toBeVisible();
  await expect.poll(async () => (await game(page)).id, { timeout: 10_000 }).not.toBe(before);
  await page.waitForFunction(() => (window as unknown as W).__aglow.state().interactive);
  const drawn = await frames(page);
  await page.waitForTimeout(1500);
  expect(await clockMs(page)).toBe(0);
  expect(await frames(page)).toBe(drawn);
  await page.keyboard.press('Escape');
  await expect(careerPage(page)).toBeHidden();
  await resumeIfPaused(page);
  const id = (await game(page)).id as string;
  await solveByTapping(page);
  await expect.poll(() => game(page), { timeout: 20_000 }).toMatchObject({ id, outcome: 'done' });
  const clock = await clockMs(page);
  const run = await page.evaluate(async (gameId) => {
    const r = await fetch(`/api/games/${encodeURIComponent(gameId)}/replay`);
    return (await r.json()) as { ms: number };
  }, id);
  // The server's time is the clock's: the 1.5 s under the page sits inside the pause, not before it.
  expect(Math.abs(run.ms - clock)).toBeLessThan(600);
});

test('Esc closes Career; Leaderboard opens the leaderboard sheet', async ({ page }) => {
  await namedPlayer(page);
  const url = page.url();
  await openCareer(page);
  await page.keyboard.press('Escape');
  await expect(careerPage(page)).toBeHidden();
  expect(page.url()).toBe(url);
  // Opening the page paused the tree; the Escape was the page's alone, so it never resumed it.
  await expect(page.locator('#pause')).toBeVisible();
  await resumeIfPaused(page);
  await openCareer(page);
  await careerPage(page).getByRole('button', { name: 'Leaderboard' }).click();
  await expect(careerPage(page)).toBeHidden();
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(board).toBeVisible();
  // The sheet's Career goes back to the page.
  await board.getByRole('button', { name: 'Career' }).click();
  await expect(board).toBeHidden();
  await expect(careerPage(page)).toBeVisible();
});

test('Watch on a row plays the run', async ({ page }) => {
  await namedPlayer(page);
  const id = await solvedRun(page);
  await openCareer(page);
  await careerPage(page).locator(`button.watch[data-id="${id}"]`).click();
  await expect(careerPage(page)).toBeHidden();
  await expect.poll(() => watching(page), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('body')).toHaveClass(/\bwatching\b/);
  expect(await careerState(page)).toEqual({ open: false, loading: false });
});

test('a guest who asks for Career gets the sign-in sheet', async ({ page }) => {
  await ready(page);
  // Signed out, the chip is Sign in (no menu, so no Career item): the sign-in card's leaderboard peek, then its Career.
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Just looking? See the leaderboard' }).click();
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await board.getByRole('button', { name: 'Career' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
  await expect(careerPage(page)).toHaveCount(0);
  expect(await careerState(page)).toEqual({ open: false, loading: false });
});

test('Your games is gone', async ({ page }) => {
  await namedPlayer(page);
  await page.locator('#account-chip').click();
  const menu = page.getByRole('dialog', { name: 'Account' });
  await expect(menu.getByRole('button', { name: 'Your games' })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Leaderboard' }).click();
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(board).toBeVisible();
  await expect(board.getByText('Your games')).toHaveCount(0);
  await expect(board.getByRole('tab')).toHaveCount(0);
  expect((await page.request.get('/api/me/games')).status()).toBe(404);
});
