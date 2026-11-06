import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { game, solveByTapping, waitInteractive, type W } from './helpers';

// Nothing in storage: the browser has never been here (the fixtures make every other spec a returning visitor).
test.use({ firstVisit: true });

const state = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());
const opening = (page: Page) => expect(page.locator('body'));

test('a first visit shows the opening, and a click skips it without turning a tile', async ({ page }) => {
  // The skip click lands where the (unseen) menu button is: it opens nothing.
  await page.goto('/?test');
  await opening(page).toHaveClass(/\bm-open\b/);
  const menuBtn = page.locator('#menu-btn');
  const box = (await menuBtn.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await opening(page).not.toHaveClass(/\bm-open\b/);
  await expect(page.locator('#menu')).toBeHidden();
  await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
  // Over: the button works again.
  await menuBtn.click();
  await expect(page.locator('#menu')).toBeVisible();

  // A first visit again (storage cleared away from the game, so its page-hide saves nothing): skip on a tile.
  await page.goto('/privacy');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/?test');
  await opening(page).toHaveClass(/\bm-open\b/);
  // The tree takes taps (the reveal is over) while the opening still plays: a click now would turn a tile.
  await waitInteractive(page);
  await opening(page).toHaveClass(/\bm-open\b/);
  const tile = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.ids[Math.floor(a.ids.length / 2)];
  });
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), tile);
  const before = await state(page);
  const log = (await game(page)).log;
  await page.mouse.click(x, y);
  // Skipped: faded, and the chrome classes off by 900 ms.
  await opening(page).not.toHaveClass(/\bm-open\b/);
  const after = await state(page);
  expect(after.bits).toEqual(before.bits);
  expect(after.rotating).toBe(0);
  expect((await game(page)).log).toBe(log);
  // Over: the next click turns the tile (it is logged).
  await page.mouse.click(x, y);
  await expect.poll(async () => (await game(page)).log).toBeGreaterThan(log);
  // Seen once: a reload goes straight to the game.
  expect(await page.evaluate(() => localStorage.getItem('aglow.opened'))).toBe('true');
  await page.reload();
  await waitInteractive(page);
  await opening(page).not.toHaveClass(/\bm-open\b/);
});

test('the first tree after the opening ranks', async ({ page }) => {
  // The first tree of a first visit, started online (a cold local Worker can miss the 1.5 s start: then it is a
  // first visit again, from scratch).
  let id: string | null = null;
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    if (attempt) await page.evaluate(() => localStorage.clear());
    await page.goto('/?test');
    await opening(page).toHaveClass(/\bm-open\b/);
    await waitInteractive(page);
    id = (await game(page)).id;
  }
  expect(id).not.toBeNull();
  // Waited out, not skipped.
  await opening(page).not.toHaveClass(/\bm-open\b/, { timeout: 10_000 });
  await solveByTapping(page);
  // Signed out, a run the server could time ranks once claimed: "Would place #…", never "Unranked: …" (clock).
  await expect(page.locator('#results .rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  expect(await game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous' });
});
