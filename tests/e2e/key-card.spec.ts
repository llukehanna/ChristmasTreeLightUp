import { expect, test } from './fixtures';
import { ready } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const card = (page: import('@playwright/test').Page) => page.locator('.key-card');

test('holding Tab shows the key card and letting go hides it', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#keys-hint')).toBeVisible();
  await page.keyboard.down('Tab');
  await expect(card(page)).toHaveClass(/show/);
  await expect(page.locator('#keys-hint')).toBeHidden();
  await page.keyboard.up('Tab');
  await expect(page.locator('.key-card.show')).toHaveCount(0);
});

test('the hint pins the card; Escape closes it without pausing', async ({ page }) => {
  await ready(page);
  await page.locator('#keys-hint').click();
  await expect(card(page)).toHaveClass(/pinned/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.key-card.show')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('paused'))).toBe(false);
});

test('Tab closes a pinned card, and its release leaves nothing open', async ({ page }) => {
  await ready(page);
  await page.locator('#keys-hint').click();
  await expect(card(page)).toHaveClass(/pinned/);
  await page.keyboard.press('Tab');
  await expect(page.locator('.key-card.show')).toHaveCount(0);
});

test('the settings row closes the menu and pins the card', async ({ page }) => {
  await ready(page);
  await page.locator('#menu-btn').click();
  await expect(page.locator('#keys-row')).toBeVisible();
  await page.locator('#keys-row').click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(card(page)).toHaveClass(/pinned/);
  await page.locator('.kc-x').click();
  await expect(page.locator('.key-card.show')).toHaveCount(0);
});

test('inside the menu Tab still moves focus and the card stays away', async ({ page }) => {
  await ready(page);
  await page.locator('#menu-btn').click();
  const prevented = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document.addEventListener('keydown', (e) => resolve(e.defaultPrevented), { once: true });
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      }),
  );
  expect(prevented).toBe(false);
  await expect(page.locator('.key-card.show')).toHaveCount(0);
});

test('below 900 px Tab does nothing and the hint is hidden', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await ready(page);
  await expect(page.locator('#keys-hint')).toBeHidden();
  const prevented = await page.evaluate(() => {
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(card(page)).toHaveCount(0);
});

test('a pinned card that stops fitting closes, and Escape then pauses as usual', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await ready(page);
  await page.locator('#keys-hint').click();
  await expect(card(page)).toHaveClass(/pinned/);
  await page.setViewportSize({ width: 800, height: 900 }); // below 900 px there is no card
  await expect(page.locator('.key-card.show')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('keys-on'))).toBe(false);
  await expect(page.locator('#keys-hint')).toBeHidden();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('paused'))).toBe(true);
});

test('the card clears the tree and the garland, centred or docked high, at laptop and desktop sizes', async ({ page }) => {
  for (const [w, h] of [[1600, 900], [1440, 900], [1440, 780], [1280, 900], [1100, 900], [960, 900], [1710, 1112]]) {
    await page.setViewportSize({ width: w, height: h });
    await ready(page);
    await page.keyboard.down('Tab');
    await expect(card(page)).toHaveClass(/show/);
    const { left, edge, top, garland } = await page.evaluate(() => {
      const c = document.querySelector('.key-card')!.getBoundingClientRect();
      const garland = parseFloat(document.body.style.getPropertyValue('--garland-bottom'));
      const a = (window as unknown as { __aglow: { ids: number[]; tileCenter(i: number): [number, number] } }).__aglow;
      let maxTile = 0;
      for (const i of a.ids) {
        const [x, y] = a.tileCenter(i);
        if (y >= c.top && y <= c.bottom) maxTile = Math.max(maxTile, x);
      }
      return { left: c.left, edge: maxTile, top: c.top, garland };
    });
    expect(left - edge).toBeGreaterThanOrEqual(12);
    expect(top).toBeGreaterThanOrEqual(garland); // never over the garland's bulbs either
    await page.keyboard.up('Tab');
  }
});
