import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openAccount, openDecorate, owning, ready } from './helpers';

// The 2026-11-16 facelift (docs/superpowers/specs/2026-11-16-aglow-facelift-design.md): one capsule HUD, one menu,
// one velvet panel material, no backdrop blur over the playing stage.

const css = (page: Page, sel: string, prop: string) =>
  page.evaluate(([s, p]) => {
    const n = document.querySelector(s);
    return n ? getComputedStyle(n).getPropertyValue(p) : null;
  }, [sel, prop] as const);

test('hud is one capsule without blur', async ({ page }) => {
  await ready(page);
  expect(await css(page, '.hud', 'backdrop-filter')).toBe('none');
  expect(await css(page, '.hud', 'background-image')).toContain('linear-gradient');
  for (const sel of ['#time', '#menu-btn']) {
    expect(await css(page, sel, 'background-image')).toBe('none');
    expect(await css(page, sel, 'backdrop-filter')).toBe('none');
  }
});

test('frost capsule uses the denser cranberry', async ({ page }) => {
  await owning(page, ['scene:frost']);
  await page.addInitScript(() => localStorage.setItem('aglow.look', JSON.stringify({ v: 1, scene: 'frost' })));
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'frost');
  expect(await css(page, '.hud', 'background-image')).toContain('rgba(158, 26, 38, 0.9)');
});

for (const width of [320, 375, 1280]) {
  test(`hud clears the wordmark at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await ready(page);
    const gap = await page.evaluate(() => document.querySelector('.hud')!.getBoundingClientRect().left - document.querySelector('.wordmark')!.getBoundingClientRect().right);
    expect(gap).toBeGreaterThanOrEqual(16);
  });
}

test('wordmark is 12.5px on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  expect(await css(page, '.wordmark', 'font-size')).toBe('12.5px');
});

test('panels share the velvet and only the menu wears a bow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  const velvet = async (sel: string) => {
    await expect(page.locator(sel)).toBeVisible();
    expect(await css(page, sel, 'backdrop-filter')).toBe('none');
    expect(await css(page, sel, 'background-image')).toContain('rgb(62, 10, 18)');
  };
  // No ribbon band and no bow anywhere but the settings menu's own.
  const flourishes = () =>
    page.evaluate(() => [...document.querySelectorAll('.bow, .deco-bow, .deco-band, .acct-band')].filter((n) => !n.closest('#menu')).length);

  await page.click('#menu-btn');
  await velvet('#menu');
  await expect(page.locator('#menu .bow')).toHaveCount(1);
  await page.click('#menu-btn');

  await page.click('#radio-pill');
  await velvet('.radio');
  expect(await flourishes()).toBe(0);
  await page.keyboard.press('Escape');

  await openAccount(page); // a guest: the sign-in sheet
  await velvet('.acct-sheet');
  expect(await flourishes()).toBe(0);
  await page.keyboard.press('Escape');
  await page.click('#pause');

  await page.click('#menu-btn');
  await page.click('#advent-row');
  await velvet('.acct-sheet');
  await page.keyboard.press('Escape');
  await page.click('#pause');

  await openDecorate(page);
  await velvet('.deco');
  expect(await flourishes()).toBe(0);
  await page.keyboard.press('Escape');

  expect(await css(page, '.toast', 'backdrop-filter')).toBe('none');
});

test('on Frost the menu keeps its light gold: the velvet is dark in every scene', async ({ page }) => {
  await owning(page, ['scene:frost']);
  await page.addInitScript(() => localStorage.setItem('aglow.look', JSON.stringify({ v: 1, scene: 'frost' })));
  await ready(page);
  await page.click('#menu-btn');
  expect(await css(page, '#ms-play', 'background-image')).toContain('rgb(248, 230, 174)');
  expect(await css(page, '#board-row svg', 'color')).toBe('rgb(214, 162, 74)');
});
