import { expect, test, type Page } from '@playwright/test';
import { rotCW } from '../../src/core/dirs';
import type { AglowProbe } from '../../src/debug';

type W = Window & { __aglow: AglowProbe };

// Model production before Plan 3: no /api/stations at all (a 404), not `vite preview`'s index.html fallback.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/stations', (r) => r.fulfill({ status: 404, body: '' }));
});

async function ready(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());
const bits = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.state().bits);
/**
 * Pin the source (once: a reload keeps what the page saved). The auto scene's suggestion depends on the clock, and
 * Playwright's Chromium has no AAC; synth sources need no files.
 */
const pinSource = (page: Page, source: string) =>
  page.addInitScript((s) => {
    if (localStorage.getItem('aglow.radio') === null)
      localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: true, source: s, embedUrl: null, volume: 0.7, shuffle: true, lightShow: true }));
  }, source);
/** Clicks the centre of a real tile. */
async function tapTile(page: Page): Promise<void> {
  const [x, y] = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.tileCenter(a.ids[40]);
  });
  await page.mouse.click(x, y);
}

test('the radio panel lists Music Box and Fireplace, and plays the Fireplace', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  const panel = page.locator('#radio-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#radio-pill')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('.stations')).toContainText('Music Box');
  await expect(panel.locator('.stations')).toContainText('Fireplace');
  // No endpoint (404) is "no remote stations", not a failure: once the catalog has settled, no warning.
  await expect.poll(async () => (await radio(page)).catalogLoaded).toBe(true);
  expect((await radio(page)).stations).toEqual([]);
  await expect(panel.locator('.warn')).toBeHidden();
  await panel.locator('.st', { hasText: 'Fireplace' }).click();
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  await expect(page.locator('#radio-pill')).toContainText('Fireplace');
  await expect(panel.locator('.st', { hasText: 'Fireplace' })).toHaveAttribute('aria-current', 'true');
  await expect(panel.locator('.title')).toHaveText('Crackle & wind');
});

test('a failing stations endpoint shows the warning, and Music Box still plays', async ({ page }) => {
  await page.route('**/api/stations', (r) => r.fulfill({ status: 503, body: '' })); // the latest route wins
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .warn')).toBeVisible();
  await page.locator('#radio-panel .st', { hasText: 'Music Box' }).click();
  await expect.poll(async () => (await radio(page)).kind).toBe('musicbox');
  await expect(page.locator('#radio-panel .credit')).toContainText('public domain, arranged for Aglow');
});

test('a Spotify playlist link becomes an embedded player; junk is rejected', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await page.click('#radio-panel .embed-row');
  const input = page.locator('#radio-panel .embed-input');
  await input.fill('not a link');
  await input.press('Enter');
  await expect(page.locator('#radio-panel .err')).toBeVisible();
  expect((await radio(page)).kind).not.toBe('embed');
  await input.fill('https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4?si=abc');
  await input.press('Enter');
  await expect(page.locator('#radio-panel .embed-frame iframe')).toHaveAttribute('src', /open\.spotify\.com\/embed\/playlist\/3rKFTakI4TxtuNLJ1Ruog4/);
  expect((await radio(page)).kind).toBe('embed');
  await expect(page.locator('#radio-panel .show')).toBeDisabled(); // embeds can't drive the light show
  // Switching away unmounts the embed.
  await page.locator('#radio-panel .st', { hasText: 'Fireplace' }).click();
  await expect(page.locator('#radio-panel .embed-frame iframe')).toHaveCount(0);
});

test('the first tile tap starts music, and only the solved tree runs the light show', async ({ page }) => {
  await pinSource(page, 'music-box');
  await ready(page);
  // A stage tap that misses every tile is not the first tile tap (the gesture is handled synchronously).
  await page.mouse.click(8, 200);
  expect((await radio(page)).playing).toBe(false);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).playing, { timeout: 5000 }).toBe(true);
  expect((await radio(page)).kind).toBe('musicbox');
  await expect(page.locator('#radio-pill')).toContainText('Music Box');
  expect((await radio(page)).lightShow).toBe(false); // music alone isn't the light show: it waits for the win
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect.poll(async () => (await radio(page)).lightShow).toBe(true);
});

test('reduced motion keeps the light show off after the win', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pinSource(page, 'music-box');
  await ready(page);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).playing).toBe(true);
  await page.evaluate(() => (window as unknown as W).__aglow.solve());
  await expect(page.locator('#results')).toBeVisible({ timeout: 8000 }); // the won tree has been drawn for 1.5s
  expect((await radio(page)).playing).toBe(true);
  expect((await radio(page)).lightShow).toBe(false);
});

test('muting from the panel is remembered across a reload', async ({ page }) => {
  await pinSource(page, 'fireplace');
  await ready(page);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).playing).toBe(true);
  await page.click('#radio-pill');
  await page.click('#radio-panel .play');
  await expect.poll(async () => (await radio(page)).playing).toBe(false);
  await expect(page.locator('#radio-pill')).toContainText('Music off');
  await ready(page);
  await tapTile(page); // the first tap starts music synchronously, so a muted radio stays silent right away
  expect((await radio(page)).playing).toBe(false);
  await expect(page.locator('#radio-pill')).toContainText('Music off');
});

test('Escape closes the radio panel and hands focus back to the pill', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('#radio-panel'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#radio-panel')).toBeHidden();
  await expect(page.locator('#radio-pill')).toBeFocused();
  await expect(page.locator('#radio-pill')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#pause')).toBeHidden(); // the Escape was the panel's, not the game's
});

test('P is ignored while focus is in the radio panel, and pauses once focus is back on the game', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#pause-btn')).toBeVisible();
  await page.click('#radio-pill');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#radio-panel'))).toBe(true);
  await page.keyboard.press('p'); // the game's key handler runs synchronously
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('#radio-panel')).toBeVisible();
  // Desktop: the popover stays open while you play. A click on the stage takes focus out of it, and P works again.
  await page.mouse.click(8, 200);
  await expect(page.locator('#radio-panel')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('#radio-panel'))).toBe(false);
  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#radio-panel')).toBeHidden(); // pausing closes it
});

test('desktop: the game stays playable behind the radio popover; opening it closes the settings menu', async ({ page }) => {
  await ready(page);
  await page.click('#menu-btn');
  await expect(page.locator('#menu')).toBeVisible();
  await page.click('#radio-pill');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#radio-panel')).toBeVisible();
  // A tile clear of the popover whose turn changes its wires (a cross looks the same turned).
  const before = await bits(page);
  const candidates = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    const left = document.getElementById('radio-panel')!.getBoundingClientRect().left;
    return a.ids.map((i) => ({ i, c: a.tileCenter(i) })).filter(({ c }) => c[0] < left - 20 && c[1] > 120);
  });
  const pick = candidates.find(({ i }) => rotCW(before[i]) !== before[i]);
  if (!pick) throw new Error('no turnable tile beside the popover');
  await page.mouse.click(pick.c[0], pick.c[1]);
  await expect.poll(async () => (await bits(page))[pick.i]).toBe(rotCW(before[pick.i]));
  await expect(page.locator('#radio-panel')).toBeVisible();
});

test('phone: a stage tap closes the radio sheet without turning anything', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.click('#radio-pill');
  const sheet = page.locator('#radio-panel');
  await expect(sheet).toBeVisible();
  // The sheet covers every tile at this size, so the tap lands on the stage just above it.
  const top = await sheet.evaluate((n) => n.getBoundingClientRect().top);
  const before = await bits(page);
  await page.mouse.click(195, top - 30);
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(300); // negative check: a turn would have finished by now
  expect(await bits(page)).toEqual(before);
});

test('while the game is paused the radio is out of reach', async ({ page }) => {
  await ready(page);
  await page.click('#pause-btn');
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('.hud')).toHaveJSProperty('inert', true);
  await expect(page.locator('#radio-panel')).toHaveJSProperty('inert', true);
  // Tab can't reach the pill inside the inert HUD.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('radio-pill');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await expect(page.locator('#radio-panel')).toHaveJSProperty('inert', false);
});

test('pausing closes an open radio panel so it never sits over the pause overlay', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel')).toBeVisible();
  // A hidden tab pauses the game while the panel is open.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#radio-panel')).toBeHidden();
});

test('Music Box shows the composer as the artist, in the panel and in the pill', async ({ page }) => {
  await pinSource(page, 'music-box');
  await ready(page);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).playing).toBe(true);
  const artist = page.locator('#radio-pill .rp-artist');
  await expect(artist).toHaveText(/^(Traditional|[A-Z][a-z]+ .+)$/);
  await expect(artist).toBeVisible(); // there is room at this width for station · title · artist
  expect(await page.locator('#radio-pill').getAttribute('data-fit')).toBe('full');
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .artist')).toHaveText((await artist.textContent()) ?? '');
  // The scrubber reads as times, and the panel's section headings follow its dialog label.
  await expect(page.locator('#radio-panel .scrub')).toHaveAttribute('aria-valuetext', /^\d+:\d\d of \d+:\d\d$/);
  await expect(page.locator('#radio-panel h2')).toHaveText(['Stations', 'Your music']);
});

test('phone: Tab and Shift+Tab stay inside the open radio sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel')).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('#radio-panel'));
  for (let k = 0; k < 25; k++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  for (let k = 0; k < 25; k++) {
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  }
});

/** `seconds` of a quiet 440 Hz sine as 16-bit mono PCM WAV (no real music: Chromium decodes WAV, not AAC). */
function toneWav(seconds: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return buf;
}

test('a remote station streams from the Blob host through /api/stations: next works and a 404 track is skipped', async ({ page }) => {
  const BLOB = 'https://test.public.blob.vercel-storage.com/tracks/christmas-classics';
  const track = (id: string, title: string) => ({ id, url: `${BLOB}/${id}.wav`, title, artist: 'Test Tone', credit: 'generated in the test', duration: 30 });
  const file = {
    version: 1,
    stations: [
      {
        id: 'christmas-classics',
        name: 'Christmas Classics',
        description: 'Generated tones',
        tracks: [track('one', 'Tone One'), track('two', 'Tone Two'), track('broken', 'Tone Broken'), track('four', 'Tone Four')],
      },
    ],
  };
  await page.route('**/api/stations', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(file) }));
  const wav = toneWav(30);
  const hits: { id: string; range: string | null; cors: boolean }[] = [];
  await page.route(`${BLOB}/*.wav`, async (r) => {
    const req = r.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const id = /\/([a-z]+)\.wav$/.exec(req.url())?.[1] ?? '';
    const range = req.headers()['range'] ?? null;
    const headers = req.headers();
    hits.push({ id, range, cors: headers['origin'] === 'http://localhost:4173' }); // a no-cors media request carries no Origin
    if (id === 'broken') return r.fulfill({ status: 404, headers: cors, body: '' });
    const base = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', ...cors };
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (!m) return r.fulfill({ status: 200, headers: base, body: wav });
    const start = m[1] === '' ? 0 : Number(m[1]);
    const end = m[2] === '' ? wav.length - 1 : Math.min(Number(m[2]), wav.length - 1);
    return r.fulfill({
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${wav.length}`, 'Content-Length': String(end - start + 1) },
      body: wav.subarray(start, end + 1),
    });
  });
  // The station is the remembered source and plays in order, so the first tile tap starts it.
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.radio') === null)
      localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: true, source: 'christmas-classics', embedUrl: null, volume: 0.7, shuffle: false, lightShow: true }));
  });
  await ready(page);
  await expect.poll(async () => (await radio(page)).stations).toEqual(['christmas-classics']);
  await tapTile(page);
  await expect.poll(async () => await radio(page), { timeout: 10_000 }).toMatchObject({ kind: 'station', playing: true });
  await page.click('#radio-pill');
  const panel = page.locator('#radio-panel');
  await expect(panel.locator('.stations')).toContainText('Christmas Classics');
  await expect(panel.locator('.title')).toHaveText('Tone One');
  await expect(panel.locator('.artist')).toHaveText('Test Tone');
  // It really plays (the position moves), not just claims to.
  await expect.poll(() => panel.locator('.pos').textContent(), { timeout: 8000 }).not.toBe('0:00');

  await panel.locator('.next').click();
  await expect(panel.locator('.title')).toHaveText('Tone Two');
  expect((await radio(page)).playing).toBe(true);
  await expect.poll(() => panel.locator('.pos').textContent(), { timeout: 8000 }).not.toBe('0:00');

  // The next track 404s: it is skipped by the error path (well inside the 8 s stall watchdog, which must not be what saves it).
  await panel.locator('.next').click();
  await expect(panel.locator('.title')).toHaveText('Tone Four', { timeout: 3000 });
  await expect.poll(async () => (await radio(page)).playing).toBe(true);
  // ...and the track after the skip really plays: its position grows.
  await expect.poll(async () => Number(/:(\d\d)$/.exec((await panel.locator('.pos').textContent()) ?? '')?.[1] ?? 0), { timeout: 5000 }).toBeGreaterThanOrEqual(1);
  expect(hits.some((h) => h.id === 'broken')).toBe(true);
  // Every media request was a CORS request (crossOrigin='anonymous'): Web Audio would silence the deck otherwise.
  expect(hits.length).toBeGreaterThan(0);
  for (const h of hits) expect(h.cors).toBe(true);
  expect((await radio(page)).kind).toBe('station'); // one failure does not make the station unavailable
});
