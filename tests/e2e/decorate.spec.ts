import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { game, openDecorate, owning, ready, silentWav, solveByTapping, swatch, typeStill, waitInteractive, type W } from './helpers';

const look = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('aglow.look') ?? 'null') as { scene: string; path: string } | null);
const drawerOpen = (page: Page) => page.locator('#decorate').evaluate((n) => n.classList.contains('open'));

test('Decorate opens from the menu; Neon and Sash apply live and survive a reload', async ({ page }) => {
  await owning(page, ['path:neon', 'scene:sash']);
  await ready(page);
  await openDecorate(page);
  await swatch(page, 'Neon').click();
  await swatch(page, 'Sash').click();
  // Live: the stage is already in the Sash, and both picks are saved.
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'sash');
  await expect(swatch(page, 'Neon')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, 'Filament')).toHaveAttribute('aria-pressed', 'false');
  expect(await look(page)).toMatchObject({ scene: 'sash', path: 'neon' });

  await page.reload();
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'sash');
  await openDecorate(page);
  await expect(swatch(page, 'Neon')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, 'Sash')).toHaveAttribute('aria-pressed', 'true');
});

test('launch day: a saved look the player has only partly earned shows what they own, locks the rest, and stays saved', async ({ page }) => {
  // An existing player on a fresh season-two device (Review Focus 2): 12 trees on this device, and a look from before.
  const saved = { v: 1, scene: 'sash', path: 'neon', palette: 'scene', topper: 'star', decor: { tinsel: false, beads: false, canes: false, skirt: false }, presents: 'game' };
  await page.addInitScript((l) => {
    if (localStorage.getItem('aglow.look')) return;
    localStorage.setItem('aglow.look', JSON.stringify(l));
    localStorage.setItem('aglow.stats', JSON.stringify({ v: 1, solved: 12, totalSeconds: 12 * 300, bestSeconds: 95, bestScore: 1000, streak: 1, longestStreak: 3, lastSolvedDay: '2025-12-20' }));
  }, saved);
  await ready(page);
  // Sash (10 trees) shows; Neon (25 trees) and the star (a tree under a minute) wait.
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'sash');
  await openDecorate(page);
  const neon = page.locator('#decorate .deco-sw[data-id="path:neon"]');
  const star = page.locator('#decorate .deco-sw[data-id="topper:star"]');
  await expect(neon).toHaveClass(/\bdeco-locked\b/);
  await expect(neon.locator('.deco-sw-l')).toHaveText('Light 25 trees · 12/25');
  await expect(star).toHaveClass(/\bdeco-locked\b/);
  await expect(star.locator('.deco-sw-l')).toHaveText('A tree under 1:00 · Sign in to track');
  await expect(swatch(page, 'Sash')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, 'Filament')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, 'Snowflake')).toHaveAttribute('aria-pressed', 'true');
  await expect(swatch(page, 'Festive')).toHaveAttribute('aria-pressed', 'true');
  // A click on a locked swatch spells out its goal and applies nothing.
  await neon.click();
  await expect(page.locator('#decorate .deco-hint')).toHaveText('Light 25 trees · 12/25');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aglow.look') ?? 'null'))).toEqual(saved);
});

test('the unseen dot waits out a run, a reload mid-run included, and clears once the drawer has been opened', async ({ page }) => {
  // Tinsel is earned and not yet seen, on every load.
  await page.addInitScript(() => {
    localStorage.setItem('aglow.unlocks', JSON.stringify({ guest: { earned: ['decor:tinsel'], known: ['decor:tinsel'], seen: [], synced: false, treesLit: 1 } }));
  });
  const dot = page.locator('#menu-btn');
  await ready(page);
  // No run yet: the dot is up.
  await expect(dot).toHaveClass(/\bhas-new\b/);
  // A move starts the run; a reload resumes it, and the dot stays down.
  const tile = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.ids[Math.floor(a.ids.length / 2)];
  });
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), tile);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await game(page)).log).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.reload();
  await waitInteractive(page);
  await expect(page.locator('#toast')).toHaveText(/welcome back/i);
  await page.waitForTimeout(800); // the session's answer re-checks the unlocks
  await expect(dot).not.toHaveClass(/\bhas-new\b/);
  // The win ends the run: the dot comes up, and opening the drawer clears it.
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 15_000 });
  await expect(dot).toHaveClass(/\bhas-new\b/);
  await openDecorate(page);
  await expect(page.locator('#decorate .deco-sw[data-id="decor:tinsel"] .deco-new')).toHaveText('New');
  await page.keyboard.press('Escape');
  await expect(dot).not.toHaveClass(/\bhas-new\b/);
});

test('a topper picked over the results is in the share image', async ({ page }) => {
  const shares = () => page.evaluate(() => (window as unknown as W).__aglow.homeAlone().shares);
  await owning(page, ['topper:angel']);
  await ready(page);
  await solveByTapping(page);
  await expect(page.locator('#results')).toBeVisible({ timeout: 15_000 });
  await expect.poll(shares).toBeGreaterThan(0);
  const before = await shares();
  // The drawer reopens over the tag; a dress pick alone (no scene or path) re-renders the image.
  await openDecorate(page);
  await swatch(page, 'Angel').click();
  await expect(swatch(page, 'Angel')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(shares).toBeGreaterThan(before);
});

test('the board stays playable with the drawer open', async ({ page }) => {
  // No glide: the stage sits in its frame at once, so where a tile shows is where it stays.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await openDecorate(page);
  const tile = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.ids[Math.floor(a.ids.length / 2)];
  });
  // The tile's centre in the stage's own coordinates, carried through the stage's transform to the screen.
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), tile);
  const box = (await page.locator('#stage').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.width).toBeLessThan(vp.width); // scaled into the frame
  const before = await game(page);
  const bits = (await page.evaluate(() => (window as unknown as W).__aglow.state())).bits[tile];
  await page.mouse.click(box.x + (x * box.width) / vp.width, box.y + (y * box.height) / vp.height);
  await expect.poll(async () => (await game(page)).log).toBe(before.log + 1);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as W).__aglow.state())).bits[tile]).not.toBe(bits);
  expect(await drawerOpen(page)).toBe(true);
});

test('Esc closes the drawer without pausing', async ({ page }) => {
  await ready(page);
  await openDecorate(page);
  // The game's keys stand aside while it's open: P doesn't pause.
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeHidden();
  await page.keyboard.press('Escape');
  expect(await drawerOpen(page)).toBe(false);
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/\bpaused\b/);
  // Closed, Esc is the game's again.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
});

test('a look picked in Home Alone waits for the house to go', async ({ page }) => {
  // The house's clips as silence and Hector's still as a 404: never the real bucket. typeStill needs the page's clock.
  await page.route('https://aglow-music.lukeghanna.com/effects/home-alone/**', (r) =>
    r.request().url().endsWith('/hector.jpg')
      ? r.fulfill({ status: 404, body: '' })
      : r.fulfill({ body: silentWav(1), contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await page.clock.install();
  await owning(page, ['scene:midnight']);
  await ready(page);
  await typeStill(page, 'kevin');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'home-alone');

  await openDecorate(page);
  await expect(page.locator('.deco-world')).toBeVisible();
  await expect(page.locator('.deco-world')).toHaveText('Your look comes back when you leave.');
  await swatch(page, 'Midnight').click();
  await expect(swatch(page, 'Midnight')).toHaveAttribute('aria-pressed', 'true');
  expect(await look(page)).toMatchObject({ scene: 'midnight' });
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'home-alone');
  await page.keyboard.press('Escape');
  expect(await drawerOpen(page)).toBe(false);

  await typeStill(page, 'kevin');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'midnight');
});
