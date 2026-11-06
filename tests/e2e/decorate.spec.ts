import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { game, openDecorate, ready, silentWav, swatch, typeStill, type W } from './helpers';

const look = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('aglow.look') ?? 'null') as { scene: string; path: string } | null);
const drawerOpen = (page: Page) => page.locator('#decorate').evaluate((n) => n.classList.contains('open'));

test('Decorate opens from the menu; Neon and Sash apply live and survive a reload', async ({ page }) => {
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
