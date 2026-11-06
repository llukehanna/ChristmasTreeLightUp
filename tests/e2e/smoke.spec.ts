import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { rotCCW, rotCW } from '../../src/core/dirs';
import { GRID } from '../../src/core/mask';
import type { AglowProbe } from '../../src/debug';
import { openDecorate, owning, swatch } from './helpers';

type W = Window & { __aglow: AglowProbe };

async function ready(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}
const state = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());
const middleTile = (page: Page) => page.evaluate(() => {
  const a = (window as unknown as W).__aglow;
  return a.ids[Math.floor(a.ids.length / 2)];
});
/** Two animation frames: lets the HUD catch up with a state change before it is read. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
async function tapTile(page: Page, i: number): Promise<void> {
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await page.mouse.click(x, y);
}

test('loads cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // A host without Plan 3's /api/stations answers 404 (the radio treats that as "no remote stations").
    const src = m.location().url;
    if (m.type() === 'error' && !m.text().includes('fonts.g') && !src.includes('/api/stations')) errors.push(m.text());
  });
  await ready(page);
  await expect(page.locator('.wordmark')).toHaveText(/aglow/i);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('tapping a tile turns it clockwise', async ({ page }) => {
  await ready(page);
  const tile = await middleTile(page);
  const before = await state(page);
  await tapTile(page, tile);
  await page.waitForTimeout(300);
  const after = await state(page);
  expect(after.bits[tile]).toBe(rotCW(before.bits[tile]));
});

test('zoomed in, the board draws under the camera and taps still hit the right tile', async ({ page }) => {
  await ready(page);
  // Record the scale of every bulb socket drawn on the stage (roundRect is only used for tile bulb sockets there;
  // the garland's sockets are pre-rendered off-screen).
  await page.evaluate(() => {
    const w = window as Window & { __rr?: number[] };
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.roundRect;
    proto.roundRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof orig>) {
      if (this.canvas.id === 'stage' && w.__rr) {
        const m = this.getTransform();
        w.__rr.push(Math.hypot(m.a, m.b));
      }
      return orig.apply(this, args);
    };
  });
  const box = await page.locator('#stage').boundingBox();
  if (!box) throw new Error('no stage');
  await page.mouse.move(box.width / 2, box.height * 0.6);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -80);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoom-reset')).toBeVisible();
  await page.evaluate(() => ((window as Window & { __rr?: number[] }).__rr = []));
  await page.waitForTimeout(300);
  const scales = await page.evaluate(() => (window as Window & { __rr?: number[] }).__rr ?? []);
  expect(scales.length).toBeGreaterThan(0);
  // exp(0.8) ≈ 2.2× zoom at dpr 1: nothing on the board may be drawn at the unzoomed scale
  expect(Math.min(...scales)).toBeGreaterThan(1.8);

  const tile = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    const inView = a.ids.filter((i) => {
      const [x, y] = a.tileCenter(i);
      return x > 20 && y > 120 && x < innerWidth - 20 && y < innerHeight - 20;
    });
    return inView[Math.floor(inView.length / 2)];
  });
  const before = await state(page);
  await tapTile(page, tile);
  await page.waitForTimeout(300);
  expect((await state(page)).bits[tile]).toBe(rotCW(before.bits[tile]));
});

test('solving shows the results card and sharing copies to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined }));
  await ready(page);
  const tapped = Date.now();
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  // The win lands the moment the last turn does: the tag is up well inside 1.2 s (silence means a light is still dark).
  await expect(page.locator('#results')).toBeVisible({ timeout: 1200 });
  expect(Date.now() - tapped).toBeLessThan(1200);
  await expect(page.locator('#r-time')).toHaveText(/^Lit in \d+:\d\d$/);
  await page.click('#r-share');
  await expect(page.locator('#toast')).toHaveText(/image copied/i);
  // One clipboard item carries both the image and the share line (desktop paste targets pick what they accept).
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const text = await (await item.getType('text/plain')).text();
    return { types: [...item.types].sort(), text, png: (await item.getType('image/png')).size };
  });
  expect(clip.types).toEqual(['image/png', 'text/plain']);
  expect(clip.text).toMatch(/^Lit the tree in \d+:\d\d · aglow\.lukeghanna\.com$/);
  expect(clip.png).toBeGreaterThan(10_000);
  await page.click('#r-keep');
  await expect(page.locator('#corner-new')).toBeVisible();
});

test('Sash puts the window up', async ({ page }) => {
  await owning(page, ['scene:sash']);
  await ready(page);
  await openDecorate(page);
  await swatch(page, 'Sash').click();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'sash');
  await expect(swatch(page, 'Sash')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 1200 });
});

for (const [label, id, what] of [['Town square', 'square', 'the square at blue hour'], ['Parlour', 'parlour', 'the parlour']] as const) {
  test(`${label} puts up ${what}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await owning(page, [`scene:${id}`]);
    await ready(page);
    await openDecorate(page);
    await swatch(page, label).click();
    await expect(page.locator('body')).toHaveAttribute('data-scene', id);
    await expect(swatch(page, label)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as unknown as W).__aglow.solve());
    await expect(page.locator('#results')).toBeVisible({ timeout: 1200 });
    expect(errors).toEqual([]);
  });
}

test('settings persist across reloads', async ({ page }) => {
  await ready(page);
  await openDecorate(page);
  await swatch(page, 'Neon').click();
  await page.reload();
  await ready(page);
  await openDecorate(page);
  await expect(swatch(page, 'Neon')).toHaveAttribute('aria-pressed', 'true');
});

test('an unfinished tree resumes after reload', async ({ page }) => {
  await ready(page);
  const tile = await middleTile(page);
  await tapTile(page, tile);
  await page.waitForTimeout(400);
  const before = await state(page);
  await page.reload();
  await ready(page);
  const after = await state(page);
  expect(after.bits).toEqual(before.bits);
  await expect(page.locator('#toast')).toHaveText(/welcome back/i);
});

test('a save made during the final turn resumes as a win', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const { solution } = (window as unknown as W).__aglow.state();
    const colors = solution.map(() => 0);
    localStorage.setItem('aglow.game', JSON.stringify({ v: 1, solution, bits: solution, colors, elapsedMs: 42_400 }));
  });
  await page.reload(); // not ready(): navigating again would start a fresh tree once the win has cleared the save
  await page.waitForFunction(() => !!(window as Window & { __aglow?: AglowProbe }).__aglow);
  expect((await state(page)).won).toBe(true);
  await expect(page.locator('#results')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#r-time')).toHaveText('Lit in 0:42');
  await expect(page.locator('#r-solved')).toHaveText('1');
  await expect(page.locator('#time')).toHaveText('0:42'); // the clock stays stopped
  expect(await page.evaluate(() => localStorage.getItem('aglow.game'))).toBeNull();
});

test('the settings dialog takes focus, closes on Escape and hands focus back', async ({ page }) => {
  await ready(page);
  await page.click('#menu-btn');
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('#menu'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#menu-btn')).toBeFocused();
  await expect(page.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'false');
});

test('the pause button stops the clock, and resuming continues it without turning a tile', async ({ page }) => {
  await ready(page);
  const time = page.locator('#time');
  const btn = page.locator('#pause-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-label', 'Pause');
  await expect(time).not.toHaveText('0:00', { timeout: 3000 });
  await btn.click();
  await expect(page.locator('#pause')).toBeVisible();
  await settle(page);
  await expect(page.locator('.hud')).toHaveJSProperty('inert', true); // controls under the overlay are out of reach
  const frozen = (await time.textContent()) ?? '';
  await page.waitForTimeout(1600);
  await expect(time).toHaveText(frozen);

  // Tapping the overlay over a tile resumes without turning that tile.
  const tile = await middleTile(page);
  const before = await state(page);
  await tapTile(page, tile);
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('.hud')).toHaveJSProperty('inert', false);
  await page.waitForTimeout(300);
  expect((await state(page)).bits[tile]).toBe(before.bits[tile]);
  await expect(time).not.toHaveText(frozen, { timeout: 3000 });

  // Keyboard: P pauses, Escape resumes.
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeVisible();
  await settle(page);
  const frozen2 = (await time.textContent()) ?? '';
  await page.waitForTimeout(1300);
  await expect(time).toHaveText(frozen2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await expect(time).not.toHaveText(frozen2, { timeout: 3000 });

  // Nothing to pause after the win.
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(btn).toBeHidden({ timeout: 4000 });
});

test('Escape pauses and Escape resumes', async ({ page }) => {
  await ready(page);
  const time = page.locator('#time');
  await expect(time).not.toHaveText('0:00', { timeout: 3000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  await settle(page);
  const frozen = (await time.textContent()) ?? '';
  await page.waitForTimeout(1000);
  await expect(time).toHaveText(frozen);
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await expect(time).not.toHaveText(frozen, { timeout: 3000 });
});

test('a held Escape toggles the pause once, not at key-repeat rate', async ({ page }) => {
  await ready(page);
  const repeats = await page.evaluate(() => {
    const press = (repeat: boolean) => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', repeat, bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    };
    press(false);
    return [press(true), press(true), press(true), press(true)];
  });
  expect(repeats).toEqual([true, true, true, true]); // the repeats are swallowed
  await expect(page.locator('#pause')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('#pause')).toBeVisible(); // still paused: the repeats did not resume it
  // A repeat alone never pauses.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true })));
  await page.waitForTimeout(300);
  await expect(page.locator('#pause')).toBeHidden();
});

test('P still toggles', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeHidden();
});

test('Escape in the settings dialog closes the dialog and does not pause', async ({ page }) => {
  await ready(page);
  await page.click('#menu-btn');
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await page.waitForTimeout(300);
  await expect(page.locator('#pause')).toBeHidden();
});

test('a key typed in an input does not pause', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'probe-input';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('#probe-input')).toHaveValue('p');
});

test('a win under the pause lifts it', async ({ page }) => {
  await ready(page);
  // Solve every tile but the one that needs the most turns, then queue that tile's turns and pause during the spin.
  const last = await page.evaluate(async () => {
    const a = (window as unknown as W).__aglow;
    const rot = (b: number): number => (b & 1 ? 8 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 4 ? 1 : 0);
    const turns = (b: number, want: number): number => {
      let n = 0;
      for (let x = b; x !== want && n < 4; x = rot(x)) n++;
      return n;
    };
    const s = a.state();
    const need = a.ids.map((i) => turns(s.bits[i], s.solution[i]));
    const worst = need.indexOf(Math.max(...need));
    a.ids.forEach((id, k) => {
      if (k !== worst) for (let n = 0; n < need[k]; n++) setTimeout(() => a.tap(id), n * 150);
    });
    await new Promise((r) => setTimeout(r, 4 * 150 + 400));
    return { id: a.ids[worst], turns: need[worst] };
  });
  expect(last.turns).toBeGreaterThanOrEqual(2);
  expect((await state(page)).won).toBe(false);
  // The last tile's turns queue behind one another; P arrives in the same task, mid-spin.
  const pausedMidSpin = await page.evaluate((l) => {
    const a = (window as unknown as W).__aglow;
    for (let n = 0; n < l.turns; n++) a.tap(l.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    return !document.getElementById('pause')!.hidden;
  }, last);
  expect(pausedMidSpin).toBe(true);
  await expect(page.locator('#results')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#pause')).toBeHidden();
  expect((await state(page)).won).toBe(true);
});

test('right-clicking a tile turns it counter-clockwise', async ({ page }) => {
  await ready(page);
  const i = await middleTile(page);
  const before = (await state(page)).bits[i];
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await page.mouse.click(x, y, { button: 'right' });
  await expect.poll(async () => (await state(page)).bits[i]).toBe(rotCCW(before));
});

const solutionKey = async (page: Page) => JSON.stringify((await state(page)).solution);

test('N starts a new tree before the first move', async ({ page }) => {
  await ready(page);
  const before = await solutionKey(page);
  await page.keyboard.press('n');
  await expect.poll(() => solutionKey(page)).not.toBe(before);
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
});

test('N mid-run asks once, then starts', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#time')).not.toHaveText('0:00', { timeout: 3000 });
  await page.waitForFunction(() => (window as unknown as W).__aglow.clock().ms > 3200);
  await tapTile(page, await middleTile(page));
  // N asks only while a tile is lit, and a random tree can start fully dark: turn the root to its solution (it lights).
  await page.evaluate((root) => {
    const a = (window as unknown as W).__aglow;
    const rot = (b: number): number => (b & 1 ? 8 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 4 ? 1 : 0);
    const s = a.state();
    if (s.litCount > 0) return;
    for (let b = s.bits[root], k = 0; b !== s.solution[root] && k < 4; b = rot(b), k++) a.tap(root);
  }, GRID.root);
  await expect.poll(async () => (await state(page)).rotating).toBe(0);
  expect((await state(page)).litCount).toBeGreaterThan(0);
  const before = await solutionKey(page);
  await page.keyboard.press('n');
  await expect(page.locator('#toast')).toHaveText('Press N again for a new tree');
  await page.waitForTimeout(300);
  expect(await solutionKey(page)).toBe(before); // asked, not started
  await page.keyboard.press('N');
  await expect.poll(() => solutionKey(page)).not.toBe(before);
  // The toast's job is done once the new tree starts: it must not linger over it.
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
});

test('N typed in an input does nothing', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'probe-input';
    document.body.append(input);
    input.focus();
  });
  const before = await solutionKey(page);
  await page.keyboard.press('n');
  await page.waitForTimeout(500);
  expect(await solutionKey(page)).toBe(before);
  await expect(page.locator('#probe-input')).toHaveValue('n');
});
