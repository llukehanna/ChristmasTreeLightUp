import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { game, solveByTapping, stopClock, waitInteractive, type W } from './helpers';

// Nothing in storage: the browser has never been here (the fixtures make every other spec a returning visitor).
test.use({ firstVisit: true });

const state = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());
const opening = (page: Page) => expect(page.locator('body'));
/** The room's lighting-up is the HUD mark (src/ui/opening.ts), and the reveal runs 900 ms before the clock starts. */
const HUD_MS = 2750;
const REVEAL_MS = 900;

/** A first visit again: storage cleared away from the game (on /privacy), so the game's page-hide saves nothing. */
async function forget(page: Page): Promise<void> {
  await page.goto('/privacy');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

test('a first visit shows the opening: a click in the dark skips it without turning a tile, one in the lit room turns it', async ({ page }) => {
  // The tree is asked for once the room is lit: not in the dark, and at once on a skip.
  const starts: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/games') starts.push(Date.now());
  });
  await page.goto('/?test');
  await opening(page).toHaveClass(/\bm-open\b/);
  await page.waitForTimeout(500);
  expect(starts).toEqual([]);
  // The skip click lands where the (unseen) menu button is: it opens nothing.
  const menuBtn = page.locator('#menu-btn');
  const box = (await menuBtn.boundingBox())!;
  const clicked = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => starts.length).toBe(1);
  expect(starts[0] - clicked).toBeLessThan(1000);
  await opening(page).not.toHaveClass(/\bm-open\b/);
  await expect(page.locator('#menu')).toBeHidden();
  await expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
  // Over: the button works again.
  await menuBtn.click();
  await expect(page.locator('#menu')).toBeVisible();

  // Again, with the page's clock in hand: the tree turns up as the room is lit, and takes taps while the opening's
  // chrome still fades (once the room is lit, a click is the game's, never a skip).
  await forget(page);
  await page.clock.install();
  await page.goto('/?test');
  await opening(page).toHaveClass(/\bm-open\b/);
  await stopClock(page);
  expect((await state(page)).bits).toEqual([]); // no tree in the dark
  // In 50 ms steps until the tree is there (its start request goes out at the HUD mark, and the answer comes in real
  // time): it arrives with its reveal still to run.
  for (let k = 0; k < 200 && (await state(page)).bits.length === 0; k++) await page.clock.runFor(50);
  expect((await state(page)).interactive).toBe(false);
  await page.clock.runFor(REVEAL_MS);
  expect((await state(page)).interactive).toBe(true);
  await opening(page).toHaveClass(/\bm-open\b/);
  const tile = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.ids[Math.floor(a.ids.length / 2)];
  });
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), tile);
  const log = (await game(page)).log;
  await page.mouse.click(x, y);
  // Skipped nothing: the opening is still on, on its own timeline (a skip would have set m-o-fast at once).
  expect(await page.evaluate(() => [...document.body.classList].filter((c) => c.startsWith('m-')))).toEqual(['m-open', 'm-o-mark', 'm-o-tag', 'm-o-hud']);
  await page.clock.resume();
  // The click turned the tile (it is logged), and the opening plays out to 4.6 s.
  await expect.poll(async () => (await game(page)).log).toBeGreaterThan(log);
  await opening(page).not.toHaveClass(/\bm-open\b/);
  // Seen once: a reload goes straight to the game.
  expect(await page.evaluate(() => localStorage.getItem('aglow.opened'))).toBe('true');
  await page.reload();
  await waitInteractive(page);
  await opening(page).not.toHaveClass(/\bm-open\b/);
});

test('the first tree after the opening ranks, timed from the lit room', async ({ page }) => {
  // When the opening began (body.m-open first set), in the page's own clock.
  await page.addInitScript(() => {
    const w = window as Window & { __openedAt?: number };
    new MutationObserver(() => {
      if (w.__openedAt === undefined && document.body?.classList.contains('m-open')) w.__openedAt = performance.now();
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  // The first tree of a first visit, started online (a cold local Worker can miss the 1.5 s start: then it is a
  // first visit again, from scratch).
  let id: string | null = null;
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    if (attempt) await forget(page);
    await page.goto('/?test');
    await opening(page).toHaveClass(/\bm-open\b/);
    await waitInteractive(page);
    id = (await game(page)).id;
  }
  expect(id).not.toBeNull();
  // The tree took taps (and its clock ran) only after the room was lit and the reveal had played: never in the dark.
  const interactiveAfter = await page.evaluate(() => {
    const w = window as unknown as W & { __openedAt: number };
    return performance.now() - w.__aglow.clock().sinceReveal - w.__openedAt;
  });
  expect(interactiveAfter).toBeGreaterThanOrEqual(HUD_MS + REVEAL_MS - 20);
  // Waited out, not skipped.
  await opening(page).not.toHaveClass(/\bm-open\b/, { timeout: 10_000 });
  const finish = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/finish'));
  const firstMove = Date.now();
  await solveByTapping(page);
  const { ms } = (await (await finish).json()) as { ms: number };
  const finished = Date.now();
  // Signed out, a run the server could time ranks once claimed: "Would place #…", never "Unranked: …" (clock).
  await expect(page.locator('#results .rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  expect(await game(page)).toMatchObject({ id, outcome: 'done', reason: 'anonymous' });
  // The ranked time is the solve's, not the opening's: the dark (about 3.5 s of it) is not on it.
  expect(ms).toBeLessThan(finished - firstMove + 1500);
});
