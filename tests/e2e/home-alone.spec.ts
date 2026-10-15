import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ready, type W } from './helpers';

test.describe.configure({ timeout: 120_000 });

const homeAlone = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.homeAlone());
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());

/** Seconds of 8 kHz mono silence as a WAV: a clip Playwright's Chromium can decode (it has no AAC). */
function silentWav(seconds = 1, rate = 8000): Buffer {
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

/** The three clips (a build fetches them from the music origin), as silence: nothing real is touched. */
const clips = (page: Page) =>
  page.route('**/effects/home-alone/**', (r) => r.fulfill({ body: silentWav(), contentType: 'audio/wav', headers: { 'access-control-allow-origin': '*' } }));

test('typed on a fresh load, before any tap, "kevin" screams: the keydown unlocks the audio; the radio is left alone', async ({ page }) => {
  await clips(page);
  // Every AudioContext the page makes, and its state just after (the page's evaluate calls count as gestures, so the
  // test asserts the context is made at all, inside the keydown: without one the scream is never even asked for).
  await page.addInitScript(() => {
    const made: AudioContext[] = [];
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(o?: AudioContextOptions) {
        super(o);
        made.push(this);
      }
    };
    (window as unknown as { __contexts: () => string[] }).__contexts = () => made.map((c) => c.state);
  });
  const contexts = () => page.evaluate(() => (window as unknown as { __contexts: () => string[] }).__contexts());
  await ready(page);
  expect(await contexts()).toEqual([]); // nothing has been tapped or clicked
  const before = await radio(page);
  await page.keyboard.type('kevin');
  await expect.poll(async () => (await homeAlone(page)).on).toBe(true);
  await expect.poll(contexts).toEqual(['running']);
  await expect.poll(async () => (await homeAlone(page)).played.scream, { timeout: 30_000 }).toBe(1);
  expect((await homeAlone(page)).asked.scream).toBe(1);
  const after = await radio(page);
  expect(after.playing).toBe(before.playing);
  expect(after.kind).toBe(before.kind);
});

test('a win in the house: the filthy animal plays once and the tag carries the line; switched off, the usual words come back', async ({ page }) => {
  await clips(page);
  await ready(page);
  await page.keyboard.type('kevin');
  await expect.poll(async () => (await homeAlone(page)).on).toBe(true);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#r-merry')).toHaveText('Keep the change, ya filthy animal.');
  await expect.poll(async () => (await homeAlone(page)).played['filthy-animal'], { timeout: 30_000 }).toBe(1);
  expect(await homeAlone(page)).toMatchObject({ line: true });
  await page.keyboard.type('kevin');
  await expect.poll(async () => (await homeAlone(page)).on).toBe(false);
  await expect(page.locator('#r-merry')).toHaveText('Merry & bright');
  expect((await homeAlone(page)).asked['filthy-animal']).toBe(1);
});
