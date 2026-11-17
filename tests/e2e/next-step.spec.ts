import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ready, waitInteractive, type W } from './helpers';

// The tag's next step and the phone bottom-sheet menu (docs/superpowers/specs/2026-11-17-aglow-next-step-design.md).

const win = async (page: Page): Promise<void> => {
  await waitInteractive(page);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 15_000 });
};

/** A new day began during the session: this device's Daily mark is an old day's. */
const newDay = (page: Page) => page.evaluate(() => localStorage.setItem('aglow.daily', JSON.stringify('2000-01-01')));

test('the tag offers no next step once the Daily is played (outside Advent)', async ({ page }) => {
  test.skip(new Date().getMonth() === 11, 'Advent may offer catch-up doors');
  await ready(page);
  await win(page);
  await expect(page.locator('#results .next-row')).toHaveCount(0);
});

test("a new day's Daily: the tag offers it, and the row starts it", async ({ page }) => {
  test.skip(new Date().getMonth() === 11 && new Date().getDate() <= 24, "in Advent the row is today's door");
  await ready(page);
  await newDay(page);
  await win(page);
  const row = page.locator('#results .next-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.next-w')).toHaveText("Today's Daily Tree");
  await row.click();
  await expect(page.locator('#daily-pill')).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
});

for (const [width, height] of [[320, 568], [375, 812]] as const) {
  test(`with the row, Keep watching stays on a ${width}×${height} screen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    await newDay(page);
    await win(page);
    await expect(page.locator('#results .next-row')).toHaveCount(1);
    await page.waitForTimeout(1000); // the tag's rise
    const keep = await page.locator('#r-keep').boundingBox();
    expect(keep).not.toBeNull();
    expect(keep!.y + keep!.height).toBeLessThanOrEqual(height);
  });
}
