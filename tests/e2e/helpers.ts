import { expect, type Page } from '@playwright/test';
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
