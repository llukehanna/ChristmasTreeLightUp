import { expect, test, type Page } from '@playwright/test';
import type { AglowProbe } from '../../src/debug';

export type W = Window & { __aglow: AglowProbe };

/** Opens the game with the test probe and waits until the tree takes taps. */
export async function ready(page: Page, path = '/?test'): Promise<void> {
  await page.goto(path);
  await waitInteractive(page);
}

export async function waitInteractive(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}

export const game = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.game());

/** The id of a tree the server started. A cold local Worker can miss the 1.5 s start; then a new tree is asked for. */
export async function onlineTree(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitInteractive(page);
    const { id } = await game(page);
    if (id) return id;
    await page.evaluate(() => (window as unknown as W).__aglow.newTree());
    await page.waitForTimeout(300);
  }
  throw new Error('the local Worker never started an online tree');
}

/** Solves the tree like a person: real taps through the game, `gapMs` apart (the server ranks gaps of 40 ms and up). */
export async function solveByTapping(page: Page, gapMs = 50): Promise<void> {
  await page.evaluate(async (gap) => {
    const a = (window as unknown as W).__aglow;
    // 90° clockwise: U→R, R→D, D→L, L→U (U=1, D=2, L=4, R=8).
    const rot = (b: number): number => (b & 1 ? 8 : 0) | (b & 8 ? 2 : 0) | (b & 2 ? 4 : 0) | (b & 4 ? 1 : 0);
    const s = a.state();
    for (const i of a.ids) {
      for (let b = s.bits[i], k = 0; b !== s.solution[i] && k < 4; b = rot(b), k++) {
        a.tap(i);
        await new Promise((r) => setTimeout(r, gap));
      }
    }
  }, gapMs);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__aglow.state().won)).toBe(true);
}

/** A unique Google account for this test: fake sign-in takes the aglow_fake_as cookie as the account. */
export async function asPlayer(page: Page): Promise<{ email: string; name: string }> {
  const tag = `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e4)}`;
  const email = `p${tag}@example.com`;
  // The configured server's origin (a temporary config may run one on another port).
  const url = new URL(test.info().project.use.baseURL ?? 'http://localhost:4173').origin;
  await page.context().addCookies([{ name: 'aglow_fake_as', value: email, url }]);
  return { email, name: `p${tag}` };
}

/** Signs in from the HUD chip; (fake) Google sends the browser back to the same page. */
export async function signInFromChip(page: Page): Promise<void> {
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
}

/** The name card a new account gets once: types a free name and saves it. */
export async function pickName(page: Page, name: string): Promise<void> {
  const card = page.getByRole('dialog', { name: 'Pick a display name' });
  await card.getByLabel('Display name').fill(name);
  await expect(card.locator('.acct-check')).toHaveText(`“${name}” is available`);
  await card.getByRole('button', { name: 'Save name' }).click();
  await expect(card).toBeHidden();
}

/**
 * Stops the page's clock (page.clock.install() before the page loaded): performance.now, Date, timers, frames and event
 * timestamps stand still until page.clock.resume(). It stops 50 ms ahead of the page's own time, never in the past
 * (a loaded machine can be slow to get there: then it is stopped where it was and asked again).
 */
export async function stopClock(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const t = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(t + 50);
      return;
    } catch (e) {
      if (attempt >= 4 || !String(e).includes('past')) throw e;
    }
  }
}

/**
 * Taps the star `times` times as a player would (a mouse click on desktop, a finger on the phone), with the page's
 * clock stopped: on a loaded machine the gaps between taps can't stretch past the egg's 1.6 s or a touch past 500 ms,
 * so the taps count as the quick ones they are. The clock runs again afterwards unless `keepStopped`.
 */
export async function tapStarStill(page: Page, times: number, touch: boolean, keepStopped = false): Promise<void> {
  const [x, y] = (await page.evaluate(() => (window as unknown as W).__aglow.star())).center;
  await stopClock(page);
  for (let k = 0; k < times; k++) {
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  }
  if (!keepStopped) await page.clock.resume();
}

/**
 * Types `word` as a player would, with the page's clock stopped (page.clock.install() before the load): a loaded machine
 * can't stretch the gaps past TypedWord's 2 s. The clock runs again afterwards unless `keepStopped`.
 */
export async function typeStill(page: Page, word: string, keepStopped = false): Promise<void> {
  await stopClock(page);
  await page.keyboard.type(word);
  if (!keepStopped) await page.clock.resume();
}

/** Seconds of 8 kHz mono silence as a WAV: a track Playwright's Chromium can play (it has no AAC). */
export function silentWav(seconds = 2, rate = 8000): Buffer {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b;
}

/** A sheet over a game in progress pauses it; this resumes, as a player tapping the overlay would. */
export async function resumeIfPaused(page: Page): Promise<void> {
  const overlay = page.locator('#pause');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}
