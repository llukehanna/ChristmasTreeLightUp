import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { asPlayer, game, pickName, ready, resumeIfPaused, signInFromChip, silentWav, stopClock, typeStill, waitInteractive, type W } from './helpers';

test.describe.configure({ timeout: 120_000 });

// The words are typed with the page's clock stopped (typeStill), so it is installed before every load.
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});

const EFFECTS = 'https://aglow-music.lukeghanna.com/effects/home-alone/';
const house = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.homeAlone());
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());
const star = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.star());
const board = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state());
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const force = (page: Page, kind: 'paint' | 'tarantula' | 'bandits' | 'iron', at?: [number, number]) =>
  page.evaluate(([k, a]) => (window as unknown as W).__aglow.forceTrap(k, a), [kind, at] as const);

/** The three clips (a build fetches them from the music origin), as silence: never the real bucket. The paths the page asked for. */
async function clips(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(`${EFFECTS}**`, (r) => {
    asked.push(new URL(r.request().url()).pathname);
    return r.fulfill({ body: silentWav(1), contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return asked;
}

async function clickTile(page: Page, i: number): Promise<void> {
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await page.mouse.click(x, y);
}

test('typing kevin brings the house in with a cross-fade and the scream, and leaves the radio alone; kevin again takes it away', async ({ page }) => {
  const asked = await clips(page);
  await ready(page);
  await expect.poll(async () => (await radio(page)).catalogLoaded).toBe(true);
  const before = await radio(page);
  expect(await house(page)).toMatchObject({ on: false });

  // With the page's clock stopped the fade has begun and can't have finished: it is caught under way.
  await typeStill(page, 'kevin', true);
  expect(await house(page)).toMatchObject({ on: true, scene: 'home-alone', fading: true });
  await page.clock.resume();
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'home-alone');
  await expect.poll(async () => (await house(page)).fading).toBe(false);
  expect(await stored(page, 'aglow.homeAlone')).toBe('true');
  await expect.poll(async () => (await house(page)).played.scream, { timeout: 30_000 }).toBe(1);
  expect(asked).toContain('/effects/home-alone/scream.mp3');
  expect(await radio(page)).toEqual(before);

  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).scene).not.toBe('home-alone');
  expect((await house(page)).on).toBe(false);
  expect(await stored(page, 'aglow.homeAlone')).toBeNull();
  expect(await radio(page)).toEqual(before);
});

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
  await expect.poll(async () => (await radio(page)).catalogLoaded).toBe(true);
  const before = await radio(page);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  // At least one context (a browser may make another along the way); the one in use, the last, runs.
  await expect.poll(async () => {
    const made = await contexts();
    return made.length > 0 && made.at(-1) === 'running';
  }).toBe(true);
  await expect.poll(async () => (await house(page)).played.scream, { timeout: 30_000 }).toBe(1);
  expect((await house(page)).asked.scream).toBe(1);
  // The radio as it was: what plays, its kind and source, the catalogue, the panel.
  expect(await radio(page)).toEqual(before);
});

test('kevin with the head on takes the head off and leaves the radio as the head going off leaves it', async ({ page }) => {
  await clips(page);
  await ready(page);
  await expect.poll(async () => (await radio(page)).catalogLoaded).toBe(true);
  const before = await radio(page);
  await typeStill(page, 'hohoho');
  await expect.poll(async () => (await star(page)).head).toBe(true);
  await expect.poll(async () => (await radio(page)).secretListed).toBe(true);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  await expect.poll(async () => (await star(page)).head).toBe(false);
  // The head going off restores the radio it found; the house itself adds nothing: the same as before the head.
  await expect.poll(() => radio(page)).toEqual(before);
});

test('the house stays after a reload, shown at once and silently', async ({ page }) => {
  await clips(page);
  await ready(page);
  await typeStill(page, 'kevin');
  await expect.poll(() => stored(page, 'aglow.homeAlone')).toBe('true');
  await ready(page);
  expect(await house(page)).toMatchObject({ on: true, scene: 'home-alone', fading: false });
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'home-alone');
  expect((await house(page)).asked.scream).toBe(0);
});

test('never with the head: kevin takes the head off, hohoho takes the house away', async ({ page }) => {
  await clips(page);
  await ready(page);
  await typeStill(page, 'hohoho');
  await expect.poll(async () => (await star(page)).head).toBe(true);

  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).scene).toBe('home-alone');
  await expect.poll(async () => (await star(page)).head).toBe(false);
  expect(await stored(page, 'aglow.starHead')).toBeNull();
  expect(await stored(page, 'aglow.homeAlone')).toBe('true');

  await typeStill(page, 'hohoho');
  await expect.poll(async () => (await star(page)).head).toBe(true);
  await expect.poll(async () => (await house(page)).on).toBe(false);
  expect(await stored(page, 'aglow.homeAlone')).toBeNull();
  await expect.poll(async () => (await house(page)).scene).toBe('aurora');
});

/** The account as /api/me reports it. */
const account = (page: Page) =>
  page.evaluate(async () => ((await (await fetch('/api/me')).json()) as { user: { starHead: boolean; homeAlone?: boolean } | null }).user);

/** Signs a fresh player in and names them; the page is left on the game. */
async function signedIn(page: Page): Promise<void> {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
}

test("signed in with the account's head still loading its sticker, kevin keeps the head off, here and on the account", async ({ page }) => {
  test.slow(); // a sign-in and two loads
  await clips(page);
  await signedIn(page);
  // The account says head (another device turned it on).
  expect(await page.evaluate(async () => (await fetch('/api/me/star-head', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"on":true}' })).status)).toBe(200);
  // A fresh load: /api/me says head, and the sticker is held while kevin is typed.
  let release = (): void => {};
  const held = new Promise<void>((r) => (release = r));
  let asked = false;
  await page.route('**/star-head.png', async (route) => {
    asked = true;
    await held;
    await route.fallback();
  });
  // Not waiting for the load event: the held sticker holds it up.
  await page.goto('/?test', { waitUntil: 'domcontentloaded' });
  await waitInteractive(page);
  await expect.poll(() => asked).toBe(true);
  expect((await star(page)).head).toBe(false);
  const off = page.waitForResponse((r) => r.url().endsWith('/api/me/star-head') && r.request().method() === 'PUT');
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  expect((await off).status()).toBe(200);
  release();
  // The sticker landing never brings the head back, and the account agrees.
  await page.waitForTimeout(500);
  expect((await star(page)).head).toBe(false);
  expect((await house(page)).on).toBe(true);
  await expect.poll(() => account(page)).toMatchObject({ starHead: false, homeAlone: true });
});

test('signed in, kevin typed before the first /api/me answers stays on and reaches the account', async ({ page }) => {
  test.slow();
  await clips(page);
  await signedIn(page);
  expect((await account(page))?.homeAlone).toBe(false);
  let release = (): void => {};
  const held = new Promise<void>((r) => (release = r));
  const me = (url: URL): boolean => url.pathname === '/api/me';
  await page.route(me, async (route) => {
    await held;
    await route.fallback();
  });
  await ready(page);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  const put = page.waitForResponse((r) => r.url().endsWith('/api/me/home-alone') && r.request().method() === 'PUT');
  release();
  expect((await put).status()).toBe(200);
  expect((await house(page)).on).toBe(true);
  await page.unroute(me);
  await expect.poll(() => account(page)).toMatchObject({ homeAlone: true });
});

test('forced traps never touch the board or the log; a tap on the tarantula still turns the tile under it', async ({ page }) => {
  await clips(page);
  await ready(page);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).fading).toBe(false);
  const i = await page.evaluate(() => (window as unknown as W).__aglow.ids[40]);
  // Traps run only while a tree is in play: one move first.
  const log0 = (await game(page)).log;
  await clickTile(page, i);
  await expect.poll(async () => (await game(page)).log).toBe(log0 + 1);
  await expect.poll(async () => (await board(page)).rotating).toBe(0);

  const bits = (await board(page)).bits;
  const log = (await game(page)).log;
  for (const kind of ['paint', 'bandits'] as const) expect(await force(page, kind)).toBe(true);
  await expect.poll(async () => (await house(page)).paint).toBe(true);
  expect((await house(page)).bandits).toBe(true);
  await expect.poll(async () => (await house(page)).paint, { timeout: 10_000 }).toBe(false); // swung in, knocked, swung out
  expect(await force(page, 'iron')).toBe(true);
  expect((await house(page)).iron).toBe(true);
  expect((await board(page)).bits).toEqual(bits);
  expect((await game(page)).log).toBe(log);

  // The tarantula, placed on the tile's centre with the page's clock stopped, then tapped there.
  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await stopClock(page);
  expect(await force(page, 'tarantula', [x, y])).toBe(true);
  expect((await house(page)).tarantula).toBe('crawl');
  await page.mouse.click(x, y);
  expect((await house(page)).tarantula).toBe('scurry');
  await page.clock.resume();
  await expect.poll(async () => (await game(page)).log).toBe(log + 1);
  await expect.poll(async () => (await board(page)).bits[i]).not.toBe(bits[i]);
});

test('a win in the house: the line on the tag and the filthy animal on the effects bus; switched off, the usual words come back', async ({ page }) => {
  const asked = await clips(page);
  await ready(page);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#r-merry')).toHaveText('Keep the change, ya filthy animal.');
  expect((await house(page)).line).toBe(true);
  await expect.poll(async () => (await house(page)).played['filthy-animal'], { timeout: 30_000 }).toBe(1);
  expect(asked).toContain('/effects/home-alone/filthy-animal.mp3');
  // The share image was made with the line.
  await expect.poll(async () => (await house(page)).shareLine).toBe(true);
  const shares = (await house(page)).shares;

  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(false);
  await expect(page.locator('#r-merry')).toHaveText('Merry & bright');
  expect((await house(page)).asked['filthy-animal']).toBe(1);
  // Switched off after the win, the share image is made again, without the line (once the fade has landed)…
  await expect.poll(async () => (await house(page)).shares, { timeout: 10_000 }).toBeGreaterThan(shares);
  expect((await house(page)).shareLine).toBe(false);
  const off = (await house(page)).shares;
  // …and switched back on, with it again.
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  await expect.poll(async () => (await house(page)).shares, { timeout: 10_000 }).toBeGreaterThan(off);
  expect((await house(page)).shareLine).toBe(true);
});

test('a tap that only closes the menu never scares the tarantula', async ({ page }) => {
  await clips(page);
  await ready(page);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).fading).toBe(false);
  const i = await page.evaluate(() => (window as unknown as W).__aglow.ids[40]);
  const log0 = (await game(page)).log;
  await clickTile(page, i); // traps run only while a tree is in play
  await expect.poll(async () => (await game(page)).log).toBe(log0 + 1);
  await expect.poll(async () => (await board(page)).rotating).toBe(0);

  const [x, y] = await page.evaluate((t) => (window as unknown as W).__aglow.tileCenter(t), i);
  await page.click('#menu-btn');
  await expect(page.locator('#menu')).toBeVisible();
  await stopClock(page);
  expect(await force(page, 'tarantula', [x, y])).toBe(true);
  await page.mouse.click(x, y); // closes the menu; never reaches the stage
  await expect(page.locator('#menu')).toBeHidden();
  expect((await house(page)).tarantula).toBe('crawl');
  await page.mouse.click(x, y); // now it does
  expect((await house(page)).tarantula).toBe('scurry');
  await page.clock.resume();
});

test('with the effects volume at 0 no clip is ever asked for or fetched', async ({ page }) => {
  const asked = await clips(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.settings') === null) {
      localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'auto', pathStyle: 'filament', effectsVolume: 0, haptics: true }));
    }
  });
  await ready(page);
  await typeStill(page, 'kevin');
  await expect.poll(async () => (await house(page)).on).toBe(true);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#r-merry')).toHaveText('Keep the change, ya filthy animal.');
  expect((await house(page)).asked).toEqual({ scream: 0, kevin: 0, 'filthy-animal': 0 });
  expect(asked).toEqual([]);
});
