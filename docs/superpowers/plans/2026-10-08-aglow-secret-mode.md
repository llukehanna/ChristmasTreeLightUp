# Aglow secret mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the star-head egg is on, Aglow becomes secret mode: an aurora world with Luke's face hidden on one ornament, one present and one garland bulb, a Secret radio station (or a dreamy celesta) that autoplays on the switch and is restored off it, the head nodding and the lights pulsing on the beat, and a face-confetti win with an optional ad-lib.

**Architecture:**

- **Data:** the stations file gains the reserved-for-it id `secret` and an optional `winSound` on that station only (`src/radio/schema.ts`, shared with the Worker); the admin save route checks the ad-lib is our own upload under `tracks/secret/`; `/admin` labels and creates the Secret station and uploads the ad-lib.
- **Radio:** a pure step function (`src/radio/secret.ts`) decides autoplay and restore; `Radio` hides the Secret station outside secret mode, plays it (or a `CELESTA`-timbre `MusicBox`) and puts the old source back; `WinSound` fetches and plays the ad-lib.
- **Render:** a fourth scene `AURORA` with a cached backdrop and three quarter-resolution curtain sprites (`src/render/aurora.ts`), a sky sweep between canvases; `FaceSprites` caches the topper's sticker for the face ornament, face paper, garland face and confetti heads; `BeatTracker` (`src/radio/beat.ts`) and pure beat effects (`src/render/beat-fx.ts`) drive the nod, pulse, palette step and bob.
- **App:** `StarEgg` reports `mode(on, how)` and a synchronous `gesture(on)`; the app switches the scene (with a sweep when by hand), the radio and the beat.

**Tech Stack:** TypeScript 7 (strict), Vite 8, vanilla canvas 2D, Web Audio, Vitest 5 (Node; jsdom where a file says so), Playwright 1.63 on `wrangler dev`, Wrangler 4.147 (Workers, D1, R2).

**Spec:** `docs/superpowers/specs/2026-10-08-aglow-secret-mode-design.md` (binding; read it alongside this plan). Approved design: `.superpowers/secret-mode-design.md` (git-ignored, local). It builds on the star-head egg (`.superpowers/star-head-brief.md`).

## Global Constraints

- **Ids** (`src/radio/ids.ts`): `SECRET_ID = 'secret'` (a valid station id; only that station may carry `winSound`; hidden by the game outside secret mode), `CELESTA_ID = 'celesta'` (refused as a station id, with `music-box`, `fireplace`, `embed`).
- **Schema:** `Station.winSound?: string`, accepted only when `id === 'secret'` and `isUrl(winSound)`. Parsed key order: `id, name, description, cover?, tracks, winSound?`.
- **Worker:** `PUT /api/admin/stations` answers 400 `{ error: 'The win ad-lib must be a file uploaded to the Secret station.' }` unless the Secret station's `winSound` has a `mediaKey` under `MUSIC_BASE_URL` starting with `tracks/secret/`. `urlsOf` includes `winSound`. No new route, no migration.
- **Aurora scene** (`AURORA`): `sky ['#050a1f', '#140f3d', '#2b1a5e']`, `ground ['#1a2350', '#0a0d24']`, `needleA [12, 40, 52]`, `needleB [36, 92, 104]`, `trunk '#0a0c14'`, `core '#f2f8ff'`, `glow '#7fd8ff'`, `copperOn 'rgba(170,215,255,.9)'`, `neon '#8a7bff'`, `neonMid '#b6a8ff'`, `socket '#3a4466'`, `bulbs ['#6dffa8', '#4fe6d6', '#7fd0ff', '#8fa2ff', '#b48cff', '#e08cff']`, `starOff 'rgba(220,235,255,.05)'`, `starEdge 'rgba(220,235,255,.32)'`, `hover '170,220,255'`, `snow '235,245,255'`, `snowAlpha 0.6`, `bloom 1`, `bulbFrost 0`, no dust, reflection or embers; unlit (every style) `{ look: 'plain', wire: 'rgba(190,210,255,.40)', wireW: 0.06, copper: 'rgba(170,190,235,.5)', led: 'rgba(220,235,255,.36)', glass: 'rgba(200,215,255,.12)', glassHi: 'rgba(255,255,255,.34)' }`. `SceneId` stays `'midnight' | 'fireside' | 'frost'`.
- **Sky:** `RES = 0.25`, `SPAN = 1.6`, `DRIFT = 0.12`; ribbons `[rgb, top, height, waves, alpha, phase, driftMs, shimmerMs, breathMs]`: green `['92,255,170', 0.06, 0.42, 1.7, 0.55, 0, 41000, 5300, 9700]`, teal `['70,214,236', 0.14, 0.34, 2.6, 0.4, 2.1, 53000, 7100, 12100]`, violet `['170,120,255', 0, 0.3, 1.2, 0.36, 4.2, 67000, 8900, 15300]`; tiers 0–1: 3 ribbons, 2: 2, 3: 1. `SWEEP_MS = 1200`, `SWEEP_FADE_MS = 300`; the by-hand sweep starts `FLIP_MS / 2` (325 ms) after the toggle (at once under reduced motion).
- **Faces:** `FACE_ORNAMENT_H = 0.56` (tiles), `FACE_GARLAND_H = 1.15` (bulb sizes), `FACE_CONFETTI_PX = 29`, `HEAD_FLECK = 4`; `FACE_PAPER = { base: '#22275e', ribbon: '#d8ecff', pattern: 'face', ink: '#22275e' }`; face paper `step = max(8, 0.26 w)`, height `0.78 step`, rows `0.82 step`, alpha `0.92`. Ornament pick: FNV-1a 32-bit (offset `0x811c9dc5`, prime `0x01000193`) over `solution[i] & 15`, `bulbs[hash % bulbs.length]`. Present: largest `w · h`, first on a tie. Garland: right swag, nearest its midpoint, first on a tie.
- **Beat:** `BEAT = { floor: 0.06, rise: 0.035, ratio: 1.3, tauMs: 300, warmupMs: 300, refractoryMs: 250, strong: 0.6 }`; strength `clamp(0.3 + 0.7 · (e / max(avg, 0.02) − 1.3) / 1.2, 0.3, 1)`. `NOD_MS = 260`, `NOD_DIP = 0.09` tiles, `NOD_SQUASH = 0.03`. Pulse `0.6 · strength · exp(−t / 180)` (reduced: `0.25 · strength · exp(−t / 250)`). Garland bob `0.05 sin(2π now / 2400) + 0.16 · strength · nodPulse(now − at)` bulb sizes (0 reduced). Beat reactions run only while secret mode is on and `radio.lightShowActive`.
- **Celesta timbre:** `mode2 2.756`, `mode2Level 0.08`, `mode2Decay 5`, `mode3 5.404`, `tineLevel 0.05`, `tineDecayS 0.02`, `attackS 0.006`, `ringScale 1.35`, `tempo 0.8`, `level 0.9`, room `send 0.42`, `tone 3000`, taps `[0.137, 0.46, -0.6]`, `[0.211, 0.42, 0.6]`.
- **Win ad-lib:** effects bus, only with effects volume > 0, ducks the music, dropped if not decoded within `WIN_SOUND_LATE_MS = 3000`.
- **Radio rules:** muted ⇔ radio volume 0; autoplay on a by-hand switch-on even with music off; any listener choice drops the saved state; the Secret station is never remembered as `source`, never the catalog fallback outside secret mode; a failing Secret station falls back to the celesta.
- **Performance:** no canvas, gradient, pattern or `Path2D` created per frame; per frame in secret mode at most 3 `drawImage` for the sky (+1 seam during a sweep), 2 for the ornament, 2 for the garland face; confetti heads only in the 6.5 s window.
- **Reduced motion:** sky crossfade 300 ms, ribbons at their `t = 0` pose, no nod, no palette step, no bob, gentle pulse only, no confetti (existing).
- **UI copy** exactly as in spec §7 (and repeated in the tasks below).
- **The Worker never imports UI or render code:** only `src/core/*`, `src/api/types.ts`, `src/api/names.ts`, `src/radio/schema.ts`, `src/radio/ids.ts`. Worker files and `src/radio/schema.ts` import with `.js` suffixes; `src/admin` files with `.js` suffixes; game `src` files extensionless.
- **TypeScript strict, no `any`** (`unknown` and narrow). Match the code style: comment density, naming, small pure helpers with unit tests.
- **Never** run `wrangler secret`, `wrangler deploy`, `--remote`, `wrangler login` or anything touching Luke's Cloudflare or Google accounts. **Never** read, copy or commit anything from `Music MP3s/`. Never push.
- **Commits** end with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Verification commands:** `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e` (Playwright builds and runs the real Worker with `wrangler dev`, fake Google, a fresh local D1; about 10 minutes). One e2e file: `npx playwright test tests/e2e/<file>.spec.ts --project=desktop`.

## File map

| File | Responsibility |
| --- | --- |
| `src/radio/ids.ts` | `SECRET_ID`, `CELESTA_ID` |
| `src/radio/schema.ts` | `Station.winSound`; `celesta` reserved |
| `worker/lib/stations-store.ts` | `isWinSoundUrl`; `winSound` in `urlsOf` |
| `worker/routes/admin/stations.ts` | The ad-lib upload check on save |
| `src/admin/validate.ts`, `src/admin/main.ts`, `src/admin/admin.css` | "+ Secret station", the badge, the win ad-lib row and upload |
| `src/radio/secret.ts` | `secretStep`: the autoplay and restore state machine (pure) |
| `src/radio/musicbox.ts` | `Timbre`, `MUSIC_BOX`, `CELESTA`; `arrange(…, tempo)` |
| `src/radio/builtin.ts` | `CELESTA_ID` is a synth source |
| `src/radio/radio.ts` | Secret mode: hidden station, autoplay, restore, celesta, `secretWinSound` |
| `src/radio/win-sound.ts` | `WinSound`: fetch, decode once, play on a bus |
| `src/ui/radio-panel.ts` | The Secret row; the celesta as a source |
| `src/render/scenes.ts` | `AURORA`, `sceneFor`, `light: 'aurora'` |
| `src/render/paint-background.ts`, `src/render/paint-tree.ts`, `src/render/presents.ts` | The aurora backdrop, tree light and gift lighting |
| `src/render/aurora.ts` | Ribbons, `sweepFrame`, the seam |
| `src/render/renderer.ts` | Sweep, aurora pass, faces wiring, beat input |
| `src/styles.css`, `src/ui/radio.css` | `body[data-scene='aurora']` |
| `src/render/faces.ts` | Face picks and sizes (pure) |
| `src/render/face-sprites.ts` | Cached lit and dim stickers per slot |
| `src/render/topper.ts` | Exported sticker helpers, `image`, `nod` |
| `src/render/bulbs.ts`, `src/render/garland.ts`, `src/render/effects.ts` | Face ornament, garland face, confetti heads |
| `src/radio/beat.ts`, `src/radio/lightshow.ts` | `BeatTracker`, fed by the light show |
| `src/render/beat-fx.ts` | `nodPulse`, `beatPulse`, `garlandBob` (pure) |
| `src/ui/star-egg.ts` | `mode` and `gesture` hooks |
| `src/app.ts`, `src/debug.ts` | Secret mode wiring; the test probe |
| `tests/e2e/secret-mode.spec.ts` | Secret mode end to end |

---

## Task order

1. The Secret station: schema, Worker save check and `/admin`
2. The radio in secret mode: state machine, celesta, Secret row, win ad-lib loader
3. The aurora scene and the sky sweep
4. Luke's face: ornament, present, garland bulb, confetti
5. On the beat: tracker, nod, pulse, palette step, bob
6. Wiring: the egg's hooks, the app, the probe and the e2e tests
7. A live local build for Luke's visual review

---

### Task 1: The Secret station: schema, Worker save check and `/admin`

**Files:**
- Modify: `src/radio/ids.ts`, `src/radio/schema.ts`
- Modify: `worker/lib/stations-store.ts`, `worker/routes/admin/stations.ts`
- Modify: `src/admin/validate.ts`, `src/admin/main.ts`, `src/admin/admin.css`
- Test: `tests/unit/radio/schema.test.ts`, `tests/unit/worker/stations-store.test.ts`, `tests/worker/admin.test.ts`, `tests/unit/admin/helpers.test.ts`, `tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `isUrl`, `parseStationsFile`, `STATION_ID` (`src/radio/schema.ts`); `mediaKey(url, base)`, `mediaBase(raw)` (`worker/lib/stations-store.ts`).
- Produces:
  - `src/radio/ids.ts`: `export const CELESTA_ID = 'celesta'`, `export const SECRET_ID = 'secret'`.
  - `src/radio/schema.ts`: `Station.winSound?: string`.
  - `worker/lib/stations-store.ts`: `isWinSoundUrl(url: string, base: string | null): boolean`.

- [ ] **Step 1: Write the failing schema tests**

Append to `tests/unit/radio/schema.test.ts`:

```ts
describe('the Secret station (secret mode)', () => {
  const secret = { id: 'secret', name: 'Secret', description: '', tracks: [track] };
  const win = 'https://aglow-music.example/tracks/secret/0123abcd-adlib.mp3';

  it('is an ordinary station id, and the only one that may carry a win ad-lib', () => {
    expect(parseStationsFile({ version: 1, stations: [secret] })).not.toBeNull();
    expect(parseStationsFile({ version: 1, stations: [{ ...secret, winSound: win }] })?.stations[0].winSound).toBe(win);
    expect(parseStationsFile({ version: 1, stations: [{ ...file.stations[0], winSound: win }] })).toBeNull();
  });

  it('refuses a win ad-lib that is not a usable URL', () => {
    for (const bad of ['http://x.example/a.mp3', 'javascript:alert(1)', '', 5, null]) {
      expect(parseStationsFile({ version: 1, stations: [{ ...secret, winSound: bad }] }), String(bad)).toBeNull();
    }
  });

  it('keeps the parsed key order, with winSound last', () => {
    const p = parseStationsFile({ version: 1, stations: [{ winSound: '/a.mp3', tracks: [], description: '', name: 'Secret', id: 'secret' }] });
    expect(Object.keys(p?.stations[0] ?? {})).toEqual(['id', 'name', 'description', 'tracks', 'winSound']);
  });

  it("reserves the celesta's id", () => {
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], id: 'celesta' }] })).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing store, Worker and admin-validation tests**

In `tests/unit/worker/stations-store.test.ts`, add `isWinSoundUrl` to the import from `../../../worker/lib/stations-store`, then append:

```ts
describe('isWinSoundUrl', () => {
  it('accepts only an upload under <base>/tracks/secret/', () => {
    expect(isWinSoundUrl(`${B}/tracks/secret/0123abcd-adlib.mp3`, B)).toBe(true);
    for (const u of [
      `${B}/tracks/christmas-jazz/a.mp3`,
      `${B}/covers/secret/a.png`,
      'https://elsewhere.example/tracks/secret/a.mp3',
      '/tracks/secret/a.mp3',
      `${B}/tracks/secret/..%2Fx.mp3`,
    ]) {
      expect(isWinSoundUrl(u, B), u).toBe(false);
    }
    expect(isWinSoundUrl(`${B}/tracks/secret/a.mp3`, null)).toBe(false);
  });
});

describe('removedMediaKeys and the win ad-lib', () => {
  const secret = (win?: string): StationsFile => ({
    version: 1,
    stations: [{ id: 'secret', name: 'Secret', description: '', tracks: [], ...(win ? { winSound: win } : {}) }],
  });
  it('sees a win ad-lib that was replaced or removed', () => {
    expect(removedMediaKeys(secret(`${B}/tracks/secret/a.mp3`), secret(`${B}/tracks/secret/b.mp3`), B)).toEqual(['tracks/secret/a.mp3']);
    expect(removedMediaKeys(secret(`${B}/tracks/secret/a.mp3`), secret(), B)).toEqual(['tracks/secret/a.mp3']);
    expect(removedMediaKeys(secret(`${B}/tracks/secret/a.mp3`), secret(`${B}/tracks/secret/a.mp3`), B)).toEqual([]);
  });
});
```

Append to `tests/worker/admin.test.ts` (inside the file, after the `admin stations` describe):

```ts
describe('the Secret station (secret mode)', () => {
  const WIN = `${B}/tracks/secret/0123abcd-adlib.mp3`;
  const secret = (winSound?: string) => ({ id: 'secret', name: 'Secret', description: '', tracks: [], ...(winSound === undefined ? {} : { winSound }) });
  const NOT_OURS = { error: 'The win ad-lib must be a file uploaded to the Secret station.' };

  it('saves a Secret station with a win ad-lib uploaded to tracks/secret/', async () => {
    const r = await putStations({ expectedVersion: 3, stations: [...v3.stations, secret(WIN)] });
    expect(r.status).toBe(200);
    expect(stored().stations[1]).toEqual(secret(WIN));
  });

  it('refuses a win ad-lib from anywhere else, or with no usable MUSIC_BASE_URL, without writing', async () => {
    const put = vi.spyOn(bucket, 'put');
    for (const url of ['https://elsewhere.example/tracks/secret/a.mp3', `${B}/tracks/christmas-jazz/a.mp3`, `${B}/covers/secret/a.png`, '/tracks/secret/a.mp3']) {
      const r = await putStations({ expectedVersion: 3, stations: [...v3.stations, secret(url)] });
      expect(r.status, url).toBe(400);
      expect(await r.json()).toEqual(NOT_OURS);
    }
    const body = JSON.stringify({ expectedVersion: 3, stations: [...v3.stations, secret(WIN)] });
    const r = await call(req('PUT', '/api/admin/stations', { headers: await authed(), body }), env({ MUSIC_BASE_URL: '' }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual(NOT_OURS);
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses a win ad-lib on any other station (the schema)', async () => {
    const r = await putStations({ expectedVersion: 3, stations: [{ ...v3.stations[0], winSound: WIN }] });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'Some station or track fields are invalid. Every track needs a title.' });
  });

  it('deletes a replaced win ad-lib after the save', async () => {
    bucket.seed('tracks/secret/old.mp3', 'media');
    bucket.seed(CURRENT, JSON.stringify({ version: 3, stations: [...v3.stations, secret(`${B}/tracks/secret/old.mp3`)] }), { contentType: 'application/json' });
    const r = await putStations({ expectedVersion: 3, stations: [...v3.stations, secret(WIN)] });
    expect(r.status).toBe(200);
    await settle();
    expect(bucket.objects.has('tracks/secret/old.mp3')).toBe(false);
  });
});
```

Append to the `firstProblem` describe in `tests/unit/admin/helpers.test.ts`:

```ts
  it('a win ad-lib belongs to the Secret station and must be a valid link', () => {
    const win = 'https://aglow-music.example/tracks/secret/0123abcd-adlib.mp3';
    expect(firstProblem([station({ id: 'secret', name: 'Secret', winSound: win })])).toBeNull();
    expect(firstProblem([station({ winSound: win })])?.message).toBe('Christmas Jazz: only the Secret station can have a win ad-lib.');
    expect(firstProblem([station({ id: 'secret', name: 'Secret', winSound: 'http://x.example/a.mp3' })])?.message).toBe(
      'Secret: the win ad-lib link is not valid. Upload it again.',
    );
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/radio/schema.test.ts tests/unit/worker/stations-store.test.ts tests/worker/admin.test.ts tests/unit/admin/helpers.test.ts`
Expected: FAIL (`winSound` dropped by the parser, `isWinSoundUrl` is not exported, the Worker saves foreign ad-libs, `firstProblem` finds no problem).

- [ ] **Step 4: Add the ids**

Replace `src/radio/ids.ts` with:

```ts
// Ids of the built-in sources, with no imports: the station schema needs them, and the schema is shared with the
// Worker (worker/**), which must not pull in browser-only modules.
export const FIREPLACE_ID = 'fireplace';
/** Synthesized public-domain carols (`musicbox.ts`): always available, needs no catalog. */
export const MUSIC_BOX_ID = 'music-box';
/** Secret mode's fallback (spec 2026-10-08 secret mode §4.5): the Music Box's carols on a dreamy celesta. */
export const CELESTA_ID = 'celesta';
/** The Secret station (spec 2026-10-08 secret mode §4.1): listed in the game only in secret mode; the only station that may carry a win ad-lib. */
export const SECRET_ID = 'secret';
```

- [ ] **Step 5: Extend the schema**

In `src/radio/schema.ts`:

```ts
import { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID, SECRET_ID } from './ids.js';
```

Add to `interface Station`, after `tracks: Track[];`:

```ts
  /** The Secret station only (spec 2026-10-08 secret mode §4.1): a short audio file played on a secret-mode win. */
  winSound?: string;
```

Replace the `RESERVED_IDS` line with:

```ts
const RESERVED_IDS: ReadonlySet<string> = new Set([MUSIC_BOX_ID, FIREPLACE_ID, CELESTA_ID, 'embed']);
```

In `parseStation`, destructure `winSound` too, check it after the `cover` check, and return it last:

```ts
  const { id, name, description, cover, tracks, winSound } = o;
  if (!isStr(id, 64) || !STATION_ID.test(id) || RESERVED_IDS.has(id) || !isStr(name, 60) || name.trim() === '' || !isStr(description, 200)) return null;
  if (cover !== undefined && !isUrl(cover)) return null;
  if (winSound !== undefined && (id !== SECRET_ID || !isUrl(winSound))) return null;
  // … the tracks loop is unchanged …
  return { id, name, description, ...(cover !== undefined ? { cover } : {}), tracks: parsed, ...(winSound !== undefined ? { winSound } : {}) };
```

- [ ] **Step 6: The store helper and the Worker check**

In `worker/lib/stations-store.ts`, add the import and the helper, and include `winSound` in `urlsOf`:

```ts
import { SECRET_ID } from '../../src/radio/ids.js';
```

```ts
const urlsOf = (f: StationsFile): string[] =>
  f.stations
    .flatMap((s) => [s.cover, s.winSound, ...s.tracks.flatMap((t) => [t.url, t.cover])])
    .filter((u): u is string => typeof u === 'string');
```

```ts
/** A win ad-lib must be our own upload for the Secret station: `<MUSIC_BASE_URL>/tracks/secret/…` (spec 2026-10-08 secret mode §4.2). */
export function isWinSoundUrl(url: string, base: string | null): boolean {
  const key = base ? mediaKey(url, base) : null;
  return key !== null && key.startsWith(`tracks/${SECRET_ID}/`);
}
```

In `worker/routes/admin/stations.ts`:

```ts
import { SECRET_ID } from '../../../src/radio/ids.js';
import { deleteKeys, isWinSoundUrl, mediaBase, readStations, removedMediaKeys, writeStations } from '../../lib/stations-store.js';
```

Right after the `if (!next) return json(…400)` line:

```ts
  const base = mediaBase(env.MUSIC_BASE_URL);
  // The shared schema can't know MUSIC_BASE_URL: the ad-lib must be a file uploaded here, for the Secret station.
  const win = next.stations.find((s) => s.id === SECRET_ID)?.winSound;
  if (win !== undefined && !isWinSoundUrl(win, base)) {
    return json({ error: 'The win ad-lib must be a file uploaded to the Secret station.' }, { status: 400 });
  }
```

and change the cleanup line to reuse it: `const removed = removedMediaKeys(current, next, base);`.

- [ ] **Step 7: Client validation**

In `src/admin/validate.ts`, import `SECRET_ID` (`import { SECRET_ID } from '../radio/ids.js';`) and add after the cover check:

```ts
    if (s.winSound !== undefined) {
      if (s.id !== SECRET_ID) return at('only the Secret station can have a win ad-lib.');
      if (!isUrl(s.winSound)) return at('the win ad-lib link is not valid. Upload it again.');
    }
```

- [ ] **Step 8: Run the unit and Worker tests to verify they pass**

Run: `npx vitest run tests/unit/radio/schema.test.ts tests/unit/worker/stations-store.test.ts tests/worker/admin.test.ts tests/unit/admin/helpers.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing admin e2e test**

Append to `tests/e2e/admin.spec.ts` (after the upload tests; it uses `admin`, `uploads`, `mp3` and `MEDIA` from that file):

```ts
test('the Secret station: its own button creates it, labelled Secret mode only; a win ad-lib uploads to tracks/secret and is saved', async ({ page }) => {
  const api = await admin(page);
  const up = await uploads(page);
  await page.getByRole('button', { name: '+ Secret station' }).click();
  const nav = page.locator('nav .station', { hasText: 'Secret mode only' });
  await expect(nav).toHaveAttribute('aria-current', 'true');
  await expect(nav).toContainText('secret · 0 tracks');
  await expect(page.getByRole('button', { name: '+ Secret station' })).toHaveCount(0);
  await expect(page.getByText('Secret mode only. The game lists this station only while secret mode is on, and plays it when secret mode is switched on.')).toBeVisible();
  const pick = page.locator('.secret-panel label.button');
  await expect(pick).toHaveText('Add win ad-lib');

  await page.getByLabel('Upload win ad-lib').setInputFiles([mp3('Ad-lib.mp3')]);
  await expect(page.locator('.up', { hasText: 'Win ad-lib: Ad-lib.mp3' })).toContainText('done');
  expect(up.seen.at(-1)).toEqual({ folder: 'tracks', station: 'secret', name: 'Ad-lib.mp3', type: 'audio/mpeg' });
  await expect(pick).toHaveText('Replace win ad-lib');
  await expect(page.getByRole('button', { name: 'Remove win ad-lib' })).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. Live in the game within a minute' })).toBeVisible();
  expect(api.puts[0].stations.find((s) => s.id === 'secret')).toEqual({
    id: 'secret', name: 'Secret', description: '', tracks: [], winSound: `${MEDIA}/tracks/secret/0123abcd-Ad-lib.mp3`,
  });

  await page.getByRole('button', { name: 'Remove win ad-lib' }).click();
  await expect(pick).toHaveText('Add win ad-lib');
  await expect(page.locator('header .sub')).toContainText('unsaved changes');
});
```

- [ ] **Step 10: The `/admin` page**

In `src/admin/main.ts`:

1. Import: `import { SECRET_ID } from '../radio/ids.js';`
2. Per-render slot, next to `let coverSlot …`: `let winSlot: HTMLElement | null = null;`, and in `render()` reset it with the others: `winSlot = null;`.
3. The persistent inputs gain a third:

```ts
const inputs = new Map<string, { tracks: HTMLInputElement; cover: HTMLInputElement; win: HTMLInputElement }>();
```

In `stationInputs`, the return type becomes `{ tracks: HTMLInputElement; cover: HTMLInputElement; win: HTMLInputElement }` and the pair:

```ts
  pair = {
    tracks: make('Upload tracks', AUDIO_ACCEPT, true, 'track'),
    cover: make('Upload cover', 'image/jpeg,image/png,image/webp', false, 'cover'),
    win: make('Upload win ad-lib', AUDIO_ACCEPT, false, 'win'),
  };
```

with, near the top constants:

```ts
const AUDIO_ACCEPT = 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.m4a,.aac,.ogg';
```

4. Jobs and results:

```ts
interface Job {
  kind: 'track' | 'cover' | 'win';
  stationId: string;
  file: File;
}
type Result = { kind: 'track'; track: Track } | { kind: 'cover'; url: string } | { kind: 'win'; url: string };
```

In `runJob`, replace the cover branch with:

```ts
  if (job.kind === 'cover' || job.kind === 'win') {
    const { url } = await upload(job.kind === 'cover' ? 'covers' : 'tracks', job, onProgress);
    return job.kind === 'cover' ? { kind: 'cover', url } : { kind: 'win', url };
  }
```

In `landed`, after the `if (!s) return;` line:

```ts
  if (result.kind === 'win') {
    s.winSound = result.url;
    touch();
    if (s.id === selected && screen === 'editor') renderWinSlot(s);
    return;
  }
```

In `updateRow`, the name cell:

```ts
      h('span', { class: 'name', textContent: item.job.kind === 'cover' ? `Cover: ${name}` : item.job.kind === 'win' ? `Win ad-lib: ${name}` : name }),
```

5. The nav: the badge, and the "+ Secret station" button before "+ New station":

```ts
function stationNav(): HTMLElement {
  const items = file.stations.map((s) => {
    const name = h('b', { textContent: s.name || s.id });
    const count = h('small', { textContent: `${s.id} · ${plural(s.tracks.length, 'track')}` });
    navNames.set(s.id, name);
    navCounts.set(s.id, count);
    const b = h('button', { class: `station${s.id === selected ? ' on' : ''}`, onclick: () => select(s.id) }, name, count);
    if (s.id === SECRET_ID) b.append(h('span', { class: 'badge', textContent: 'Secret mode only' }));
    if (s.id === selected) b.setAttribute('aria-current', 'true');
    return b;
  });
  const secret = !stationById(SECRET_ID) && file.stations.length < MAX_STATIONS ? [h('button', { class: 'add secret', textContent: '+ Secret station', onclick: () => createSecret() })] : [];
  return h(
    'nav',
    { class: 'stations', attrs: { 'aria-label': 'Stations' } },
    ...items,
    ...secret,
    creating ? newStationForm() : h('button', { class: 'add', textContent: '+ New station', onclick: () => ((creating = true), render()) }),
  );
}

/** The Secret station (spec 2026-10-08 secret mode §4.3): the game lists and plays it only in secret mode. */
function createSecret(): void {
  if (stationById(SECRET_ID) || file.stations.length >= MAX_STATIONS) return;
  file.stations.push({ id: SECRET_ID, name: 'Secret', description: '', tracks: [] });
  selected = SECRET_ID;
  creating = false;
  touch();
  render();
}
```

6. The editor: in `stationEditor`, return the Secret panel after `meta` for the Secret station:

```ts
  return h(
    'section',
    { class: 'editor', attrs: { 'aria-label': s.name || s.id } },
    h('div', { class: 'fields' }, field('name', 'Name', 60), field('description', 'Description', 200, 'Shown under the station name')),
    meta,
    ...(s.id === SECRET_ID ? [secretPanel(s)] : []),
    tableHost,
    drop,
  );
```

and add:

```ts
function secretPanel(s: Station): HTMLElement {
  winSlot = h('div', { class: 'win' });
  renderWinSlot(s);
  return h(
    'div',
    { class: 'secret-panel' },
    h('p', { class: 'note', textContent: 'Secret mode only. The game lists this station only while secret mode is on, and plays it when secret mode is switched on.' }),
    winSlot,
  );
}

/** The win ad-lib: a preview, Add or Replace (the persistent file input), Remove. */
function renderWinSlot(s: Station): void {
  if (!winSlot) return;
  const kids: (Node | string)[] = [h('b', { textContent: 'Win ad-lib' })];
  if (s.winSound) kids.push(h('audio', { controls: true, preload: 'none', src: s.winSound }));
  kids.push(h('label', { class: 'button' }, s.winSound ? 'Replace win ad-lib' : 'Add win ad-lib', stationInputs(s.id).win));
  if (s.winSound) {
    kids.push(
      h('button', {
        textContent: 'Remove win ad-lib',
        onclick: () => {
          delete s.winSound;
          touch();
          renderWinSlot(s);
        },
      }),
    );
  }
  kids.push(h('small', { class: 'dim', textContent: 'Plays once when a tree is solved in secret mode, if game sounds are on.' }));
  winSlot.replaceChildren(...kids);
}
```

7. `src/admin/admin.css`, after `nav .add { … }`:

```css
nav .station .badge { font-size: 11px; color: #9fe7ff; border: 1px solid currentColor; border-radius: 999px; padding: 0 6px; }
nav .add.secret { border-color: rgba(159, 231, 255, 0.5); color: #9fe7ff; }
.secret-panel { margin-bottom: 18px; }
.secret-panel .win { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.secret-panel audio { height: 32px; }
```

- [ ] **Step 11: Typecheck, the unit suite and the admin e2e**

Run: `npm run typecheck && npm test`
Expected: PASS.
Run: `npx playwright test tests/e2e/admin.spec.ts --project=desktop`
Expected: PASS (the new test and every existing admin test).

- [ ] **Step 12: Commit**

```bash
git add src/radio/ids.ts src/radio/schema.ts worker/lib/stations-store.ts worker/routes/admin/stations.ts src/admin/validate.ts src/admin/main.ts src/admin/admin.css tests/unit/radio/schema.test.ts tests/unit/worker/stations-store.test.ts tests/worker/admin.test.ts tests/unit/admin/helpers.test.ts tests/e2e/admin.spec.ts
git commit -m "feat(stations): the Secret station and its win ad-lib: schema, save check, /admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The radio in secret mode: state machine, celesta, Secret row, win ad-lib loader

**Files:**
- Create: `src/radio/secret.ts`, `src/radio/win-sound.ts`
- Modify: `src/radio/musicbox.ts`, `src/radio/builtin.ts`, `src/radio/radio.ts`, `src/ui/radio-panel.ts`
- Test: `tests/unit/radio/secret.test.ts`, `tests/unit/radio/win-sound.test.ts`, `tests/unit/radio/musicbox.test.ts`, `tests/unit/radio/radio.test.ts`

**Interfaces:**
- Consumes: `SECRET_ID`, `CELESTA_ID` (Task 1); `Station.winSound` (Task 1); `CAROLS` (`src/radio/carols.ts`).
- Produces:
  - `src/radio/secret.ts`: `interface RadioSnapshot { source: string | null; on: boolean; remembered: string | null }`, `interface SecretState { on: boolean; saved: RadioSnapshot | null }`, `type SecretEvent`, `type SecretEffect`, `SECRET_OFF`, `isSecretSource(id)`, `secretStep(s, e): { state; effect }`.
  - `src/radio/musicbox.ts`: `interface Timbre`, `MUSIC_BOX`, `CELESTA`, `arrange(c, plays?, tempo = 1)`, `new MusicBox(carols?, rng?, timbre?)`.
  - `src/radio/radio.ts`: `SourceKind` gains `'celesta'`; `RadioView.secretMode: boolean`, `RadioView.secretStation: Station | null`; `Radio.secretMode` (getter), `Radio.primeSecret(): void`, `Radio.setSecret(on: boolean, autoplay: boolean): void`, `Radio.secretWinSound(): string | null`. `Radio.firstGesture()` keeps its own "first move handled" flag (spec §4.4, ruling 18).
  - `src/radio/win-sound.ts`: `WIN_SOUND_LATE_MS = 3000`; `class WinSound { preload(url: string | null, ctx: AudioContext | null): void; play(url: string, ctx: AudioContext, out: AudioNode, clock?: () => number): Promise<boolean> }`.

- [ ] **Step 1: Write the failing state-machine tests**

Create `tests/unit/radio/secret.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SECRET_OFF, isSecretSource, secretStep, type RadioSnapshot, type SecretState } from '../../../src/radio/secret';

const jazz: RadioSnapshot = { source: 'christmas-jazz', on: true, remembered: 'christmas-jazz' };
const on = (autoplay: boolean, muted = false) => ({ type: 'on' as const, autoplay, muted, current: jazz });
const off = (playingSecret: boolean, musicOn = true) => ({ type: 'off' as const, playingSecret, musicOn });

describe('secretStep (spec §4.4)', () => {
  it('by hand and not muted: saves what was playing and plays the Secret station', () => {
    expect(secretStep(SECRET_OFF, on(true))).toEqual({ state: { on: true, saved: jazz }, effect: { kind: 'play-secret' } });
  });
  it('a quiet switch, or a muted radio: on, nothing saved, nothing played', () => {
    expect(secretStep(SECRET_OFF, on(false))).toEqual({ state: { on: true, saved: null }, effect: { kind: 'none' } });
    expect(secretStep(SECRET_OFF, on(true, true))).toEqual({ state: { on: true, saved: null }, effect: { kind: 'none' } });
  });
  it('on again is a no-op', () => {
    const s: SecretState = { on: true, saved: jazz };
    expect(secretStep(s, on(true))).toEqual({ state: s, effect: { kind: 'none' } });
  });
  it('off with something saved restores it', () => {
    expect(secretStep({ on: true, saved: jazz }, off(true))).toEqual({ state: SECRET_OFF, effect: { kind: 'restore', to: jazz } });
  });
  it('off with nothing saved: leaves a secret source (resuming if music is on), else does nothing', () => {
    expect(secretStep({ on: true, saved: null }, off(true, true))).toEqual({ state: SECRET_OFF, effect: { kind: 'leave', resume: true } });
    expect(secretStep({ on: true, saved: null }, off(true, false))).toEqual({ state: SECRET_OFF, effect: { kind: 'leave', resume: false } });
    expect(secretStep({ on: true, saved: null }, off(false))).toEqual({ state: SECRET_OFF, effect: { kind: 'none' } });
  });
  it('off again is a no-op', () => {
    expect(secretStep(SECRET_OFF, off(true))).toEqual({ state: SECRET_OFF, effect: { kind: 'none' } });
  });
  it("the listener's own choice drops what was saved", () => {
    expect(secretStep({ on: true, saved: jazz }, { type: 'choice' })).toEqual({ state: { on: true, saved: null }, effect: { kind: 'none' } });
    expect(secretStep(SECRET_OFF, { type: 'choice' }).state).toBe(SECRET_OFF);
  });
  it('knows the sources only secret mode plays', () => {
    expect(['secret', 'celesta', 'music-box', null].map(isSecretSource)).toEqual([true, true, false, false]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/radio/secret.test.ts`
Expected: FAIL ("Cannot find module …/secret").

- [ ] **Step 3: Write `src/radio/secret.ts`**

```ts
import { CELESTA_ID, SECRET_ID } from './ids';

/**
 * Secret mode's hold on the radio (spec 2026-10-08 secret mode §4.4), as a pure step: switching on by hand saves what
 * the radio was doing and plays the Secret station; switching off puts it back. A listener's own choice in between
 * wins: nothing is restored over it.
 */

/** What the radio was doing when secret mode took it over. */
export interface RadioSnapshot {
  /** The audible source (a station id, 'music-box', 'fireplace' or 'embed'), or null when nothing was playing. */
  source: string | null;
  /** The listener's saved settings at the time: music on, and the remembered source. */
  on: boolean;
  remembered: string | null;
}

export interface SecretState {
  on: boolean;
  saved: RadioSnapshot | null;
}

export type SecretEvent =
  | { type: 'on'; autoplay: boolean; muted: boolean; current: RadioSnapshot }
  | { type: 'off'; playingSecret: boolean; musicOn: boolean }
  | { type: 'choice' };

export type SecretEffect =
  | { kind: 'none' }
  | { kind: 'play-secret' }
  | { kind: 'restore'; to: RadioSnapshot }
  | { kind: 'leave'; resume: boolean };

export const SECRET_OFF: SecretState = { on: false, saved: null };
const NONE: SecretEffect = { kind: 'none' };

/** The sources only secret mode plays. */
export const isSecretSource = (id: string | null): boolean => id === SECRET_ID || id === CELESTA_ID;

export function secretStep(s: SecretState, e: SecretEvent): { state: SecretState; effect: SecretEffect } {
  switch (e.type) {
    case 'on':
      if (s.on) return { state: s, effect: NONE };
      if (e.autoplay && !e.muted) return { state: { on: true, saved: e.current }, effect: { kind: 'play-secret' } };
      return { state: { on: true, saved: null }, effect: NONE };
    case 'off':
      if (!s.on) return { state: s, effect: NONE };
      if (s.saved) return { state: SECRET_OFF, effect: { kind: 'restore', to: s.saved } };
      return { state: SECRET_OFF, effect: e.playingSecret ? { kind: 'leave', resume: e.musicOn } : NONE };
    case 'choice':
      return { state: s.saved ? { on: s.on, saved: null } : s, effect: NONE };
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/radio/secret.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing celesta and win-sound tests**

Append to `tests/unit/radio/musicbox.test.ts` (add `CELESTA`, `MUSIC_BOX` to its import from `../../../src/radio/musicbox`, and `CAROLS` from `../../../src/radio/carols` if not already imported):

```ts
describe('the celesta (secret mode)', () => {
  it('plays the same carols slower: the tempo stretches every time', () => {
    const c = CAROLS[0];
    const a = arrange(c, 1);
    const b = arrange(c, 1, CELESTA.tempo);
    expect(b.duration).toBeCloseTo(a.duration / CELESTA.tempo, 6);
    expect(b.events.map((e) => e.midi)).toEqual(a.events.map((e) => e.midi));
    expect(b.events[5].t).toBeCloseTo(a.events[5].t / CELESTA.tempo, 6);
  });
  it('the music box keeps its own sound; the celesta is softer, purer and wetter', () => {
    expect(MUSIC_BOX).toMatchObject({ mode2: 6.267, mode2Level: 0.22, mode2Decay: 8, mode3: 17.55, tineLevel: 0.18, tineDecayS: 0.012, attackS: 0.002, ringScale: 1, tempo: 1, level: 0.98 });
    expect(MUSIC_BOX.room).toEqual({ send: 0.2, tone: 3800, taps: [[0.067, 0.3, -0.5], [0.103, 0.28, 0.5]] });
    expect(CELESTA).toMatchObject({ mode2: 2.756, mode2Level: 0.08, mode2Decay: 5, mode3: 5.404, tineLevel: 0.05, tineDecayS: 0.02, attackS: 0.006, ringScale: 1.35, tempo: 0.8, level: 0.9 });
    expect(CELESTA.room).toEqual({ send: 0.42, tone: 3000, taps: [[0.137, 0.46, -0.6], [0.211, 0.42, 0.6]] });
  });
});
```

Create `tests/unit/radio/win-sound.test.ts`:

```ts
import { expect, it, vi } from 'vitest';
import { WIN_SOUND_LATE_MS, WinSound } from '../../../src/radio/win-sound';

function fakeCtx() {
  const started: unknown[] = [];
  const ctx = {
    decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ length: b.byteLength })),
    createBufferSource: () => {
      const src = { buffer: null as unknown, connect: vi.fn(), start: () => started.push(src) };
      return src;
    },
  };
  return { ctx: ctx as unknown as AudioContext, started };
}
const out = {} as AudioNode;
const bytes = () => new Response(new Uint8Array(8));

it('fetches and decodes once per URL, then plays it once on the bus it is given', async () => {
  const fetchFn = vi.fn(async () => bytes());
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  w.preload('/w.mp3', ctx);
  w.preload('/w.mp3', ctx);
  expect(await w.play('/w.mp3', ctx, out)).toBe(true);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(started).toHaveLength(1);
});

it('does nothing without a URL or a context', () => {
  const fetchFn = vi.fn(async () => bytes());
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  w.preload(null, fakeCtx().ctx);
  w.preload('/w.mp3', null);
  expect(fetchFn).not.toHaveBeenCalled();
});

it('forgets a failure, so the next try fetches again', async () => {
  let ok = false;
  const fetchFn = vi.fn(async () => (ok ? bytes() : new Response('', { status: 404 })));
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  expect(await w.play('/w.mp3', ctx, out)).toBe(false);
  ok = true;
  expect(await w.play('/w.mp3', ctx, out)).toBe(true);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(started).toHaveLength(1);
});

it('drops an ad-lib decoded more than 3 s after the win', async () => {
  let t = 0;
  const fetchFn = vi.fn(async () => {
    t += WIN_SOUND_LATE_MS + 1;
    return bytes();
  });
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  expect(await w.play('/w.mp3', ctx, out, () => t)).toBe(false);
  expect(started).toHaveLength(0);
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run tests/unit/radio/musicbox.test.ts tests/unit/radio/win-sound.test.ts`
Expected: FAIL (`CELESTA` is not exported; no `win-sound` module).

- [ ] **Step 7: The celesta timbre**

In `src/radio/musicbox.ts`, replace the block from `/** Cantilever mode ratios …` through `const ATTACK_S = 0.002;` with:

```ts
/** One instrument's voice: its partials, envelopes, tempo and room. */
export interface Timbre {
  /** Second and third mode, as multiples of the fundamental. */
  mode2: number;
  mode2Level: number;
  /** How many times faster the second mode dies than the body. */
  mode2Decay: number;
  mode3: number;
  /** The strike's transient (pin click plus the third mode). */
  tineLevel: number;
  tineDecayS: number;
  attackS: number;
  /** Multiplies ringTime. */
  ringScale: number;
  /** Multiplies every carol's bpm. */
  tempo: number;
  /** Station output level into the music bus. */
  level: number;
  room: { send: number; tone: number; taps: readonly (readonly [delay: number, feedback: number, pan: number])[] };
}

/**
 * The music box: cantilever mode ratios (Euler–Bernoulli, clamped-free), a 2 ms pluck, a light room. Output level set
 * by measurement (RMS about −22 dBFS into the music bus at full volume).
 */
export const MUSIC_BOX: Timbre = {
  mode2: 6.267, mode2Level: 0.22, mode2Decay: 8, mode3: 17.55, tineLevel: 0.18, tineDecayS: 0.012, attackS: 0.002,
  ringScale: 1, tempo: 1, level: 0.98,
  room: { send: 0.2, tone: 3800, taps: [[0.067, 0.3, -0.5], [0.103, 0.28, 0.5]] },
};

/**
 * Secret mode's fallback (spec 2026-10-08 secret mode §4.5): a dreamy celesta. Felt hammers on steel bars over
 * resonators: a softer attack and click, a purer tone whose second mode sits where a free bar's does (2.756×) and
 * dies fast, a longer ring, slower carols and a bigger, wetter room.
 */
export const CELESTA: Timbre = {
  mode2: 2.756, mode2Level: 0.08, mode2Decay: 5, mode3: 5.404, tineLevel: 0.05, tineDecayS: 0.02, attackS: 0.006,
  ringScale: 1.35, tempo: 0.8, level: 0.9,
  room: { send: 0.42, tone: 3000, taps: [[0.137, 0.46, -0.6], [0.211, 0.42, 0.6]] },
};
```

Delete `/** Station output level … */ const LEVEL = 0.98;`.

`arrange` gains the tempo:

```ts
export function arrange(c: Carol, plays = playsFor(c), tempo = 1): Score {
  const spb = 60 / (c.bpm * tempo);
```

The constructor takes the timbre:

```ts
  constructor(
    private readonly carols: readonly Carol[] = CAROLS,
    private readonly rng: Rng = Math.random,
    private readonly timbre: Timbre = MUSIC_BOX,
  ) {}
```

In `start`: `input.gain.value = this.timbre.level;` and `this.room = buildRoom(ctx, input, master, this.timbre.room);`.
In `begin`: `const score = arrange(carol, playsFor(carol), this.timbre.tempo);`.
In `tick`, the retire line: `this.retire(p, p.cur.start + p.score.duration + ringTime(BASS_LO) * this.timbre.ringScale + 0.5);`.
In `voice`, read the timbre (`const T = this.timbre;`) and replace each constant: `MODE2` → `T.mode2`, `MODE2_LEVEL` → `T.mode2Level`, `MODE2_DECAY_FACTOR` → `T.mode2Decay`, `MODE3` → `T.mode3`, `TINE_LEVEL` → `T.tineLevel`, `TINE_DECAY_S` → `T.tineDecayS`, `ATTACK_S` → `T.attackS`, and `const ring = ringTime(ev.midi) * T.ringScale;`.

`buildRoom` takes the room:

```ts
function buildRoom(ctx: AudioContext, input: AudioNode, out: AudioNode, room: Timbre['room']): AudioNode[] {
  const send = ctx.createGain();
  send.gain.value = room.send;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = room.tone;
  input.connect(send).connect(tone);
  const nodes: AudioNode[] = [send, tone];
  for (const [delay, feedback, pan] of room.taps) {
    // … the loop body is unchanged …
  }
  return nodes;
}
```

- [ ] **Step 8: Write `src/radio/win-sound.ts`**

```ts
/** A win ad-lib not decoded this long after the win is dropped: late, it would talk over the results card. */
export const WIN_SOUND_LATE_MS = 3000;

/**
 * The Secret station's win ad-lib (spec 2026-10-08 secret mode §4.6): fetched and decoded once per URL (the media host
 * allows CORS), then played once per win on the bus it is given. A failed fetch or decode is forgotten, so the next
 * try fetches again.
 */
export class WinSound {
  private url: string | null = null;
  private decoded: Promise<AudioBuffer | null> | null = null;

  constructor(private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init)) {}

  preload(url: string | null, ctx: AudioContext | null): void {
    if (!url || !ctx || (url === this.url && this.decoded)) return;
    this.url = url;
    const job: Promise<AudioBuffer | null> = this.fetchFn(url, { mode: 'cors' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch(() => {
        if (this.decoded === job) this.decoded = null;
        return null;
      });
    this.decoded = job;
  }

  /** Plays `url` once on `out` as soon as it is decoded. Resolves whether it played. */
  async play(url: string, ctx: AudioContext, out: AudioNode, clock: () => number = () => performance.now()): Promise<boolean> {
    const asked = clock();
    this.preload(url, ctx);
    const buffer = await this.decoded;
    if (!buffer || this.url !== url || clock() - asked > WIN_SOUND_LATE_MS) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    src.start();
    return true;
  }
}
```

- [ ] **Step 9: Run them to verify they pass**

Run: `npx vitest run tests/unit/radio/musicbox.test.ts tests/unit/radio/win-sound.test.ts`
Expected: PASS (and every existing music-box test still passes).

- [ ] **Step 10: Write the failing `Radio` tests**

In `tests/unit/radio/radio.test.ts`, make the served catalog per test. Add after `const STATIONS = …`:

```ts
const WITH_SECRET = { version: 1, stations: [...STATIONS.stations, station('secret')] };
let served: unknown = STATIONS;
```

In `beforeEach`, set `served = STATIONS;` and make the stub answer `new Response(JSON.stringify(served))`. Add `import { MusicBox } from '../../../src/radio/musicbox';` if missing (it is imported already). Append:

```ts
describe('secret mode (spec §4.4)', () => {
  /** Music Box and the celesta need a real context: record their start instead. */
  const boxes = () => vi.spyOn(MusicBox.prototype, 'start').mockImplementation(() => undefined);

  it('never lists the Secret station, and says whether secret mode is on', async () => {
    served = WITH_SECRET;
    const r = await ready();
    expect(r.view().stations.map((s) => s.id)).toEqual(['christmas-jazz', 'christmas-classics']);
    expect(r.view()).toMatchObject({ secretMode: false, secretStation: { id: 'secret' } });
    r.setSecret(true, false);
    expect(r.view().secretMode).toBe(true);
    expect(r.view().stations.map((s) => s.id)).not.toContain('secret');
  });

  it('by hand: plays the Secret station (never remembered), and switching off restores what played', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('christmas-jazz');
    r.setSecret(true, true);
    expect(r.view().station?.id).toBe('secret');
    expect(loadRadioSettings().source).toBe('christmas-jazz');
    r.setSecret(false, true);
    expect(r.view().station?.id).toBe('christmas-jazz');
    expect(loadRadioSettings()).toMatchObject({ on: true, source: 'christmas-jazz' });
  });

  it('with no playable Secret station, plays the celesta; off restores the silence it found', async () => {
    fakeAudio();
    const start = boxes();
    const r = await ready();
    r.setSecret(true, true);
    expect(r.view().kind).toBe('celesta');
    expect(start).toHaveBeenCalledTimes(1);
    r.setSecret(false, true);
    expect(r.view().kind).toBeNull();
    expect(r.view().playing).toBe(false);
  });

  it('a muted radio, or a quiet switch, plays nothing', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.setSecret(true, false);
    expect(r.view().kind).toBeNull();
    r.setSecret(false, false);
    r.setVolume(0);
    r.setSecret(true, true);
    expect(r.view().kind).toBeNull();
  });

  it('switched on before the catalog arrives: primed in the gesture, plays when it lands', async () => {
    fakeAudio();
    served = WITH_SECRET;
    let open!: () => void;
    gate = new Promise<void>((res) => (open = res));
    const prime = vi.spyOn(RadioPlayer.prototype, 'prime');
    const r = new Radio();
    r.primeSecret();
    r.setSecret(true, true);
    expect(prime).toHaveBeenCalled();
    expect(r.view().kind).toBeNull();
    open();
    await vi.waitFor(() => expect(r.view().station?.id).toBe('secret'));
  });

  it("the listener's own pick wins: switching off no longer restores", async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('christmas-jazz');
    r.setSecret(true, true);
    r.select('christmas-classics');
    r.setSecret(false, true);
    expect(r.view().station?.id).toBe('christmas-classics');
  });

  it('off with a secret source and nothing saved: moves on to the preferred source', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.setScene('frost');
    r.setSecret(true, false);
    r.select('secret');
    expect(r.view().station?.id).toBe('secret');
    expect(loadRadioSettings().source).toBeNull();
    r.setSecret(false, false);
    expect(r.view().station?.id).toBe('christmas-classics');
  });

  it('the Secret station is the suggestion in secret mode, and never the fallback outside it', async () => {
    fakeAudio();
    boxes();
    served = { version: 1, stations: [station('secret')] };
    const r = await ready();
    r.playPause();
    expect(r.view().kind).toBe('musicbox');
    r.playPause();
    r.setSecret(true, false);
    r.playPause();
    expect(r.view().station?.id).toBe('secret');
  });

  it('select("secret") only works in secret mode; select("celesta") never', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.select('secret');
    r.select('celesta');
    expect(r.view().kind).toBeNull();
    r.setSecret(true, false);
    r.select('secret');
    expect(r.view().station?.id).toBe('secret');
  });

  it('a Secret station that keeps failing falls back to the celesta', async () => {
    fakeAudio();
    boxes();
    served = WITH_SECRET;
    const r = await ready();
    r.setSecret(true, true);
    (r as unknown as { player: RadioPlayer }).player.onUnavailable?.(true);
    expect(r.view().kind).toBe('celesta');
  });

  it('switched on and off before the first move: the first move still starts the music', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.primeSecret();
    r.setSecret(true, true);
    r.setSecret(false, true);
    expect(r.view().kind).toBeNull();
    r.firstGesture();
    expect(r.view().station?.id).toBe('christmas-jazz'); // the default fireside scene's suggestion
  });

  it('the first move never interrupts what secret mode started', async () => {
    fakeAudio();
    served = WITH_SECRET;
    const r = await ready();
    r.primeSecret();
    r.setSecret(true, true);
    r.firstGesture();
    expect(r.view().station?.id).toBe('secret');
  });

  it('hands out the Secret station win ad-lib', async () => {
    served = { version: 1, stations: [{ ...station('secret'), winSound: '/w.mp3' }] };
    const r = await ready();
    expect(r.secretWinSound()).toBe('/w.mp3');
  });
});
```

- [ ] **Step 11: Run them to verify they fail**

Run: `npx vitest run tests/unit/radio/radio.test.ts`
Expected: FAIL (`setSecret` is not a function).

- [ ] **Step 12: `CELESTA_ID` is a synth source**

In `src/radio/builtin.ts`:

```ts
import { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID } from './ids';

export { CELESTA_ID, FIREPLACE_ID, MUSIC_BOX_ID };
```

```ts
/** Built-in sources that are synthesized in the browser, so they work without the station catalog. */
export const isSynthSource = (id: string | null): id is typeof FIREPLACE_ID | typeof MUSIC_BOX_ID | typeof CELESTA_ID =>
  id === FIREPLACE_ID || id === MUSIC_BOX_ID || id === CELESTA_ID;
```

- [ ] **Step 13: Secret mode in `Radio`**

In `src/radio/radio.ts`:

1. Imports:

```ts
import { CELESTA_ID, FIREPLACE_ID, isSynthSource, MUSIC_BOX_ID, SCENE_STATION } from './builtin';
import { CAROLS } from './carols';
import { SECRET_ID } from './ids';
import { CELESTA, MusicBox } from './musicbox';
import { SECRET_OFF, secretStep, type RadioSnapshot, type SecretEvent, type SecretState } from './secret';
```

2. `export type SourceKind = 'station' | 'musicbox' | 'celesta' | 'fireplace' | 'embed';` and add to `RadioView`:

```ts
  /** Secret mode is on (spec 2026-10-08 secret mode): the panel shows the Secret row. */
  secretMode: boolean;
  /** The catalog's Secret station, playable or not (never in `stations`). */
  secretStation: Station | null;
```

3. Fields, after `private readonly musicbox = new MusicBox();`:

```ts
  /** Secret mode's fallback when the Secret station can't play. */
  private readonly celesta = new MusicBox(CAROLS, Math.random, CELESTA);
  private secret: SecretState = SECRET_OFF;
  /** Switched on by hand before the catalog arrived: play the Secret station (or the celesta) when it does. */
  private pendingSecret = false;
  /** The player's first move has been handled (it may come after secret mode already primed the bus). */
  private greeted = false;
```

   `firstGesture` stops relying on `prepare()`'s first-time result (which `primeSecret` may already have used up):

```ts
  /** Call from every tile tap. The first starts the remembered source or the suggestion (spec §5.2), unless something already plays. */
  firstGesture(): void {
    this.prepare();
    if (this.greeted) return;
    this.greeted = true;
    if (this.settings.on && this.kind === null && !this.pendingStart && !this.pendingSecret) this.startPreferred();
  }
```

4. Constructor, after the music box's `onChange`:

```ts
    this.celesta.onChange = () => {
      if (this.kind === 'celesta') this.syncMusicBoxSession();
      this.onChange?.();
    };
```

5. `refreshCatalog`, replace the `pendingStart` block with:

```ts
    // Decks were primed and the context unlocked inside the first gesture, so this non-gesture start is allowed.
    if (this.pendingSecret) {
      this.pendingStart = false;
      this.playSecret();
    } else if (this.pendingStart) {
      this.pendingStart = false;
      if (this.settings.on) this.startPreferred();
    }
```

6. Public API, after `setScene`:

```ts
  /** Secret mode is on (spec 2026-10-08 secret mode §4.4). */
  get secretMode(): boolean {
    return this.secret.on;
  }

  /**
   * Inside the gesture that is turning secret mode on: unlock, fade the bus in and prime the decks, so the start that
   * follows the sticker's load (outside the gesture) may play.
   */
  primeSecret(): void {
    this.prepare();
    this.player.prime();
  }

  /** Secret mode switched. `autoplay`: by the player's own hand, so the Secret station plays (unless muted). */
  setSecret(on: boolean, autoplay: boolean): void {
    const e: SecretEvent = on
      ? { type: 'on', autoplay, muted: this.settings.volume <= 0, current: this.snapshotNow() }
      : { type: 'off', playingSecret: this.playingSecret(), musicOn: this.settings.on };
    const { state, effect } = secretStep(this.secret, e);
    this.secret = state;
    if (!state.on) this.pendingSecret = false;
    if (effect.kind === 'play-secret') this.playSecret();
    else if (effect.kind === 'restore') this.restore(effect.to);
    else if (effect.kind === 'leave') {
      this.stopAll();
      if (effect.resume) this.startPreferred();
    }
    this.onChange?.();
  }

  /** The Secret station's win ad-lib, if it has one. */
  secretWinSound(): string | null {
    return this.catalog.find((s) => s.id === SECRET_ID)?.winSound ?? null;
  }
```

7. `select`:

```ts
  /** An explicit choice by the listener: remembered as the preferred source (the Secret row never is). */
  select(source: string): void {
    if (source === CELESTA_ID) return; // reached through the Secret row only
    if (source === SECRET_ID) {
      if (this.secret.on) this.playSecret();
      return;
    }
    if (this.play(source, true)) this.choice();
  }
```

8. `playPause`: call `this.choice();` right after `this.prepare();`, and stop the celesta like the music box:

```ts
    } else if (this.kind === 'fireplace' || this.kind === 'musicbox' || this.kind === 'celesta' || this.kind === 'embed') {
```

9. `next` / `prev`: add `else if (this.kind === 'celesta') this.celesta.next();` (and `.prev()`).

10. `view()`:

```ts
  view(): RadioView {
    const snap = this.player.snapshot();
    const box = this.kind === 'musicbox' ? this.musicbox : this.kind === 'celesta' ? this.celesta : null;
    const carol = box?.current() ?? null;
    const boxId = this.kind === 'celesta' ? CELESTA_ID : MUSIC_BOX_ID;
    return {
      kind: this.kind,
      playing: this.isPlaying(),
      station: this.kind === 'station' ? snap.station : null,
      track: carol
        ? { id: `${boxId}:${carol.id}`, url: '', title: carol.title, artist: carol.artist, credit: carol.credit, duration: carol.duration }
        : this.kind === 'station'
          ? snap.track
          : null,
      position: carol ? carol.position : snap.position,
      duration: carol ? carol.duration : snap.duration,
      stations: this.catalog.filter((s) => s.id !== SECRET_ID),
      unavailable: (id) => this.player.isUnavailable(id),
      embed: this.embed,
      remoteOk: this.remoteOk,
      settings: this.settings,
      secretMode: this.secret.on,
      secretStation: this.catalog.find((s) => s.id === SECRET_ID) ?? null,
    };
  }
```

11. `isPlaying`: add `this.kind === 'celesta' ||` to the synth list.

12. `needsCatalog` and `preferredSource`:

```ts
  /** Music Box, Fireplace and a set-up embed work without the station catalog, and so does a scene that suggests Music Box. */
  private needsCatalog(): boolean {
    const s = this.settings.source;
    if (isSynthSource(s) || (s === 'embed' && this.embed)) return false;
    if (s === null && this.secret.on) return true; // the suggestion is the Secret station, if the catalog has one
    return !(s === null && isSynthSource(SCENE_STATION[this.sceneId]));
  }

  private preferredSource(): string {
    const s = this.settings.source === SECRET_ID ? null : this.settings.source;
    if (isSynthSource(s) || (s === 'embed' && this.embed)) return s;
    const byId = (id: string | null): Station | undefined => (id === null ? undefined : this.catalog.find((x) => x.id === id && this.playable(x)));
    // In secret mode the Secret station (or the celesta) is the suggestion, as a scene's station is otherwise.
    const suggested = this.secret.on ? this.secretSource() : SCENE_STATION[this.sceneId];
    const chosen =
      byId(s)?.id ??
      (isSynthSource(suggested) ? suggested : byId(suggested)?.id) ??
      this.catalog.find((x) => x.id !== SECRET_ID && this.playable(x))?.id;
    return chosen ?? MUSIC_BOX_ID; // the catalog has loaded with nothing usable: Music Box is always there
  }
```

13. `onRemote`: `if (this.kind === 'musicbox' || this.kind === 'celesta') {` and inside, route `next`/`prev` through `this.next()`/`this.prev()` (unchanged).

14. `onStationUnavailable`:

```ts
    if (wasPlaying) {
      // The Secret station falls back to the celesta; any other to the Music Box.
      this.play(this.player.snapshot().station?.id === SECRET_ID ? CELESTA_ID : MUSIC_BOX_ID, false);
    } else {
```

15. `play` returns whether the source took over, and starts the celesta:

```ts
  /** Returns false when the source can't play (unknown, unplayable, no context): the current source is left alone. */
  private play(source: string, remember: boolean): boolean {
    let station: Station | undefined;
    if (source === 'embed') {
      if (!this.embed) return false;
    } else if (!isSynthSource(source)) {
      station = this.catalog.find((s) => s.id === source);
      if (!station || !this.playable(station)) return false;
    }
    this.prepare();
    const ctx = audio.ctx;
    if (isSynthSource(source) && (!ctx || !audio.music)) return false;
    this.pendingStart = false;
    const already =
      (source === FIREPLACE_ID && this.kind === 'fireplace') ||
      (source === MUSIC_BOX_ID && this.kind === 'musicbox') ||
      (source === CELESTA_ID && this.kind === 'celesta') ||
      (source === 'embed' && this.kind === 'embed') ||
      (station !== undefined && this.kind === 'station' && this.player.snapshot().station?.id === station.id);
    if (already) {
      if (station && !this.player.snapshot().playing) this.player.resume();
      this.save({ on: true, ...(remember ? { source } : {}) });
      return true;
    }
    this.stopAll();
    if (source === FIREPLACE_ID && ctx && audio.music) {
      this.fireplace.start(ctx, audio.music);
      this.kind = 'fireplace';
    } else if ((source === MUSIC_BOX_ID || source === CELESTA_ID) && ctx && audio.music) {
      const box = source === CELESTA_ID ? this.celesta : this.musicbox;
      box.start(ctx, audio.music);
      this.kind = source === CELESTA_ID ? 'celesta' : 'musicbox';
      this.player.claimMediaSession();
      this.syncMusicBoxSession();
    } else if (station) {
      this.player.playStation(station);
      this.kind = 'station';
    } else {
      this.kind = 'embed';
    }
    this.save({ on: true, ...(remember ? { source } : {}) });
    return true;
  }
```

16. `stopAll`: add `this.celesta.stop(audio.ctx);`. `syncMusicBoxSession`: `const c = (this.kind === 'celesta' ? this.celesta : this.musicbox).current();`.

17. The private helpers (after `stopAll`):

```ts
  /** What the radio is doing now, for secret mode to put back later. */
  private snapshotNow(): RadioSnapshot {
    let source: string | null = null;
    if (this.isPlaying()) {
      if (this.kind === 'station') source = this.player.snapshot().station?.id ?? null;
      else if (this.kind === 'musicbox') source = MUSIC_BOX_ID;
      else if (this.kind === 'fireplace') source = FIREPLACE_ID;
      else if (this.kind === 'embed') source = 'embed';
    }
    return { source, on: this.settings.on, remembered: this.settings.source };
  }

  private playingSecret(): boolean {
    return this.kind === 'celesta' || (this.kind === 'station' && this.player.snapshot().station?.id === SECRET_ID);
  }

  /** The Secret station if it can play, else the celesta. */
  private secretSource(): string {
    const s = this.catalog.find((x) => x.id === SECRET_ID);
    return s && this.playable(s) ? SECRET_ID : CELESTA_ID;
  }

  /** Plays the Secret station (or the celesta), never remembered. Before the catalog has loaded, waits for it. */
  private playSecret(): void {
    if (!this.loaded) {
      this.pendingSecret = true;
      return;
    }
    this.pendingSecret = false;
    this.play(this.secretSource(), false);
  }

  /** Puts back what secret mode took over: its source (or silence) and the listener's saved settings. */
  private restore(to: RadioSnapshot): void {
    const back = to.source !== null && this.play(to.source, false);
    if (!back) this.stopAll();
    this.save({ on: to.on, source: to.remembered });
  }

  /** The listener's own choice: secret mode no longer puts the old source back over it. */
  private choice(): void {
    this.secret = secretStep(this.secret, { type: 'choice' }).state;
    this.pendingSecret = false;
  }
```

- [ ] **Step 14: Run the radio tests to verify they pass**

Run: `npx vitest run tests/unit/radio`
Expected: PASS (new and existing).

- [ ] **Step 15: The Secret row in the radio panel**

In `src/ui/radio-panel.ts`:

1. `import { SECRET_ID } from '../radio/ids';`
2. In `render()`: `const carol = v.kind === 'musicbox' || v.kind === 'celesta';`
3. In `renderPill()`: `const song = on && (v.kind === 'station' || v.kind === 'musicbox' || v.kind === 'celesta') && v.track ? v.track : null;`
4. In `sourceName()`: `case 'celesta': return 'Secret';`
5. `renderStations`:

```ts
  private renderStations(v: RadioView): void {
    // Secret mode (spec 2026-10-08 secret mode §4.4): one Secret row on top, the station when it can play, else the celesta.
    const secret = v.secretStation;
    const playable = !!secret && secret.tracks.length > 0;
    const secretKey = v.secretMode ? `secret:${secret?.name ?? ''}:${secret?.description ?? ''}:${secret?.tracks.length ?? 0}|` : '';
    const key = secretKey + v.stations.map((s) => s.id).join(',');
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows = [
        ...(v.secretMode
          ? [{
              id: SECRET_ID,
              name: secret?.name || 'Secret',
              desc: playable && secret ? secret.description || `${secret.tracks.length} tracks` : 'Dreamy celesta carols',
              icon: ICON.star,
            }]
          : []),
        ...v.stations.map((s) => ({
          id: s.id,
          name: s.name,
          desc: s.description || `${s.tracks.length} tracks`,
          icon: /classic/i.test(s.id) ? ICON.star : ICON.note,
        })),
        { id: MUSIC_BOX_ID, name: MUSIC_BOX_META.name, desc: 'Public-domain carols, always on', icon: ICON.bell },
        { id: FIREPLACE_ID, name: 'Fireplace', desc: 'Crackle & wind, no music', icon: ICON.flame },
      ];
      // The loop that builds a button per row (const box = this.q('.stations') … box.append(b)) stays as it is.
    }
    for (const r of this.rows) {
      const b = r.node;
      if (!b) continue;
      const current =
        r.id === SECRET_ID ? v.kind === 'celesta' || (v.kind === 'station' && v.station?.id === SECRET_ID)
        : r.id === FIREPLACE_ID ? v.kind === 'fireplace'
        : r.id === MUSIC_BOX_ID ? v.kind === 'musicbox'
        : v.kind === 'station' && v.station?.id === r.id;
      const unavailable = r.id !== FIREPLACE_ID && r.id !== MUSIC_BOX_ID && r.id !== SECRET_ID && v.unavailable(r.id);
      b.setAttribute('aria-current', String(current));
      b.classList.toggle('live', current && v.playing);
      b.disabled = unavailable && !current;
      setText(b.querySelector('.d') as HTMLElement, unavailable ? 'Unavailable right now' : r.desc);
      setText(b.querySelector('.lbl') as HTMLElement, current ? (v.playing ? 'Playing' : 'Paused') : '');
    }
  }
```

- [ ] **Step 16: Typecheck and the whole unit suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add src/radio/secret.ts src/radio/win-sound.ts src/radio/musicbox.ts src/radio/builtin.ts src/radio/radio.ts src/ui/radio-panel.ts tests/unit/radio/secret.test.ts tests/unit/radio/win-sound.test.ts tests/unit/radio/musicbox.test.ts tests/unit/radio/radio.test.ts
git commit -m "feat(radio): secret mode: the Secret station autoplays and is put back, a celesta fallback, the win ad-lib loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The aurora scene and the sky sweep

**Files:**
- Modify: `src/render/scenes.ts`, `src/render/paint-background.ts`, `src/render/paint-tree.ts`, `src/render/presents.ts` (lighting only), `src/render/renderer.ts`, `src/styles.css`, `src/ui/radio.css`
- Create: `src/render/aurora.ts`
- Test: `tests/unit/render/scenes.test.ts`, `tests/unit/render/aurora.test.ts`

**Interfaces:**
- Consumes: `Layout`, `Y` (`src/render/layout.ts`), `blurredLayer` (`src/render/blur.ts`), `mulberry32`.
- Produces:
  - `src/render/scenes.ts`: `Scene.light: 'moon' | 'fire' | 'day' | 'aurora'`, `Scene.id: SceneId | 'aurora'`, `AURORA: Scene`, `sceneFor(id: SceneId, secret: boolean): Scene`.
  - `src/render/aurora.ts`: `RES`, `SPAN`, `DRIFT`, `SWEEP_MS`, `SWEEP_FADE_MS`, `interface Ribbon`, `RIBBONS`, `ribbonCount(tier)`, `interface SweepFrame { cover; alpha; edge; done }`, `sweepFrame(t, dir: 'down' | 'up', reduced, out?)`, `class Aurora { draw(c, L, now, tier, reduced, alpha = 1): void; drawSeam(c, L, y, k): void }`.
  - `src/render/renderer.ts`: `setScene(scene: Scene, sweep: { now: number; reduced: boolean } | null = null)`, `get secret(): boolean`, `get sweeping(): boolean`.

- [ ] **Step 1: Write the failing scene test**

Append to `tests/unit/render/scenes.test.ts` (import `AURORA`, `sceneFor` from scenes and `hexRgb` from `../../../src/render/color`):

```ts
/** HSL hue in degrees. */
const hue = (hex: string): number => {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

it('the aurora: a night scene of its own, six cool bulbs in hue order, shown only in secret mode', () => {
  expect(AURORA).toMatchObject({
    id: 'aurora', light: 'aurora', sky: ['#050a1f', '#140f3d', '#2b1a5e'], ground: ['#1a2350', '#0a0d24'],
    needleA: [12, 40, 52], needleB: [36, 92, 104], trunk: '#0a0c14', bulbFrost: 0, core: '#f2f8ff', glow: '#7fd8ff',
    copperOn: 'rgba(170,215,255,.9)', neon: '#8a7bff', neonMid: '#b6a8ff', socket: '#3a4466',
    starOff: 'rgba(220,235,255,.05)', starEdge: 'rgba(220,235,255,.32)', hover: '170,220,255', snow: '235,245,255',
    snowAlpha: 0.6, bloom: 1, snowDust: false, reflect: false, embers: false,
  });
  for (const u of Object.values(AURORA.unlit)) expect(u.look).toBe('plain');
  expect(AURORA.bulbs).toEqual(['#6dffa8', '#4fe6d6', '#7fd0ff', '#8fa2ff', '#b48cff', '#e08cff']);
  const hues = AURORA.bulbs.map(hue);
  for (let k = 1; k < hues.length; k++) expect(hues[k]).toBeGreaterThan(hues[k - 1]);
  expect(sceneFor('frost', true)).toBe(AURORA);
  expect(sceneFor('frost', false)).toBe(SCENES.frost);
  expect(Object.keys(SCENES)).toEqual(['midnight', 'fireside', 'frost']); // not a menu pick
});
```

- [ ] **Step 2: Write the failing aurora tests**

Create `tests/unit/render/aurora.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Aurora, RIBBONS, SWEEP_FADE_MS, SWEEP_MS, ribbonCount, sweepFrame } from '../../../src/render/aurora';
import { computeLayout } from '../../../src/render/layout';

afterEach(() => vi.restoreAllMocks());

/** A 2D context that logs every call by name (drawImage's arguments too) and keeps plain properties. */
function recorder(names: string[], draws: unknown[][]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        names.push(String(k));
        if (k === 'drawImage') draws.push(args);
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('sweepFrame', () => {
  it('down covers the sky from the top with an eased edge; up uncovers it; nothing moves before it starts', () => {
    expect(sweepFrame(-100, 'down', false)).toEqual({ cover: 0, alpha: 1, edge: 0, done: false });
    expect(sweepFrame(-100, 'up', false).cover).toBe(1);
    const mid = sweepFrame(SWEEP_MS / 2, 'down', false);
    expect(mid.cover).toBeCloseTo(0.5);
    expect(mid.edge).toBeCloseTo(1);
    expect(sweepFrame(SWEEP_MS * 0.25, 'down', false).cover).toBeLessThan(0.25);
    expect(sweepFrame(SWEEP_MS, 'down', false)).toMatchObject({ cover: 1, edge: 0, done: true });
    expect(sweepFrame(SWEEP_MS, 'up', false)).toMatchObject({ cover: 0, done: true });
  });
  it('reduced motion: a 300 ms crossfade over the whole sky, no edge', () => {
    expect(sweepFrame(SWEEP_FADE_MS / 2, 'down', true)).toEqual({ cover: 1, alpha: 0.5, edge: 0, done: false });
    expect(sweepFrame(SWEEP_FADE_MS / 2, 'up', true).alpha).toBe(0.5);
    expect(sweepFrame(SWEEP_FADE_MS, 'up', true)).toMatchObject({ alpha: 0, done: true });
  });
});

describe('Aurora', () => {
  const L = computeLayout(390, 844, 2);
  let made = 0;
  beforeEach(() => {
    made = 0;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') made++;
      return create(tag);
    }) as typeof document.createElement);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([], [])) as never);
  });

  it('draws one quarter-resolution sprite per curtain: 3, then 2 on tier 2, 1 on tier 3', () => {
    expect([0, 1, 2, 3].map(ribbonCount)).toEqual([3, 3, 2, 1]);
    const a = new Aurora();
    for (const [tier, n] of [[0, 3], [1, 3], [2, 2], [3, 1]] as const) {
      const names: string[] = [];
      const draws: unknown[][] = [];
      a.draw(recorder(names, draws), L, 1000 + tier, tier, false);
      expect(draws).toHaveLength(n);
    }
  });

  it('bakes its sprites once per layout and allocates nothing per frame', () => {
    const a = new Aurora();
    a.draw(recorder([], []), L, 0, 0, false);
    expect(made).toBe(RIBBONS.length);
    const names: string[] = [];
    for (let t = 16; t < 2000; t += 16) a.draw(recorder(names, []), L, t, 0, false);
    expect(made).toBe(RIBBONS.length);
    expect(names.filter((n) => n.startsWith('create'))).toEqual([]);
    a.draw(recorder([], []), computeLayout(1440, 900, 2), 0, 0, false);
    expect(made).toBe(RIBBONS.length * 2);
  });

  it('drifts with time; under reduced motion it holds one pose', () => {
    const a = new Aurora();
    const at = (now: number, reduced: boolean) => {
      const draws: unknown[][] = [];
      a.draw(recorder([], draws), L, now, 0, reduced);
      return draws.map((d) => d.slice(1));
    };
    expect(at(5000, false)).not.toEqual(at(20000, false));
    expect(at(5000, true)).toEqual(at(20000, true));
  });

  it('the seam is one drawImage, only while the edge shows', () => {
    const a = new Aurora();
    const draws: unknown[][] = [];
    a.drawSeam(recorder([], draws), L, 100, 0);
    expect(draws).toHaveLength(0);
    a.drawSeam(recorder([], draws), L, 100, 0.5);
    a.drawSeam(recorder([], draws), L, 120, 0.7);
    expect(draws).toHaveLength(2);
    expect(made).toBe(1);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/render/scenes.test.ts tests/unit/render/aurora.test.ts`
Expected: FAIL (`AURORA`, `aurora.ts` missing).

- [ ] **Step 4: The scene record**

In `src/render/scenes.ts`:

```ts
/** The menu's scenes. Secret mode's aurora (spec 2026-10-08 secret mode §2) is not one of them. */
export type SceneId = 'midnight' | 'fireside' | 'frost';
```

In `interface Scene`: `id: SceneId | 'aurora';` and `light: 'moon' | 'fire' | 'day' | 'aurora';`. After `SCENES`:

```ts
/** Secret mode's world (spec 2026-10-08 secret mode §2.1): deep navy to violet, ice-blue light, a cool fir. */
export const AURORA: Scene = {
  id: 'aurora', light: 'aurora',
  sky: ['#050a1f', '#140f3d', '#2b1a5e'], ground: ['#1a2350', '#0a0d24'],
  needleA: [12, 40, 52], needleB: [36, 92, 104], trunk: '#0a0c14',
  unlit: everyStyle({
    look: 'plain', wire: 'rgba(190,210,255,.40)', wireW: 0.06, copper: 'rgba(170,190,235,.5)', led: 'rgba(220,235,255,.36)',
    glass: 'rgba(200,215,255,.12)', glassHi: 'rgba(255,255,255,.34)',
  }),
  bulbFrost: 0, core: '#f2f8ff', glow: '#7fd8ff', copperOn: 'rgba(170,215,255,.9)', neon: '#8a7bff', neonMid: '#b6a8ff',
  // In hue order (green → orchid): a strong beat steps every lit bulb to its neighbour (§5.3).
  socket: '#3a4466', bulbs: ['#6dffa8', '#4fe6d6', '#7fd0ff', '#8fa2ff', '#b48cff', '#e08cff'],
  starOff: 'rgba(220,235,255,.05)', starEdge: 'rgba(220,235,255,.32)', hover: '170,220,255',
  snow: '235,245,255', snowAlpha: 0.6, bloom: 1, snowDust: false, reflect: false, embers: false,
};

/** The scene on screen: the aurora while secret mode is on, whatever the hour or the menu says. */
export const sceneFor = (id: SceneId, secret: boolean): Scene => (secret ? AURORA : SCENES[id]);
```

- [ ] **Step 5: Backdrop, tree light and gift light**

In `src/render/paint-background.ts`, dispatch and add `paintAurora`:

```ts
  if (sc.light === 'moon') paintMoonlit(c, L, r, hz);
  else if (sc.light === 'fire') paintFireside(c, L, r, hz);
  else if (sc.light === 'aurora') paintAurora(c, L, r, hz);
  else paintDaylight(c, L, hz);
```

```ts
/** Secret mode's sky (spec 2026-10-08 secret mode §2.2): violet at the horizon, stars, a faint baked haze, snow. The curtains are aurora.ts's. */
function paintAurora(c: CanvasRenderingContext2D, L: Layout, r: Rng, hz: number): void {
  const { w, h, s } = L;
  const glow = c.createRadialGradient(w * 0.5, hz, 0, w * 0.5, hz, w * 0.7);
  glow.addColorStop(0, 'rgba(150,110,255,.14)');
  glow.addColorStop(1, 'rgba(150,110,255,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, hz);
  for (let i = 0; i < 140; i++) {
    const x = r() * w;
    const y = r() * hz * 0.75;
    const z = r();
    c.fillStyle = `rgba(225,235,255,${0.05 + z * z * 0.5})`;
    disc(c, x, y, 0.35 + z * 0.75);
  }
  // A faint haze where the curtains hang, so a still frame (reduced motion, the lowest quality tier) still reads as aurora.
  blurredLayer(c, L.dpr, s * 1.2, (o) => {
    o.fillStyle = 'rgba(90,255,180,.06)';
    o.beginPath();
    o.ellipse(w * 0.5, hz * 0.25, w * 0.55, hz * 0.09, 0, 0, TAU);
    o.fill();
  });
  c.strokeStyle = 'rgba(160,190,255,.12)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, hz);
  c.lineTo(w, hz);
  c.stroke();
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(200,225,255,${r() * 0.3})`;
    c.fillRect(r() * w, hz + r() * (h - hz), 1, 1);
  }
}
```

In `src/render/paint-tree.ts`, add before the final `else` of the lighting pass:

```ts
  } else if (sc.light === 'aurora') {
    // Aurora light from above, the skirt in shadow.
    lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
    lg.addColorStop(0, 'rgba(120,255,210,.14)');
    lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,.30)');
```

In `src/render/presents.ts` `lighting()`, after the `'moon'` line:

```ts
  if (sc.light === 'aurora') return { ambient: [0.18, 0.26, 0.4], face: { front: 0.9, top: 1.4, side: 0.65 }, warm: g, lightFace };
```

- [ ] **Step 6: Write `src/render/aurora.ts`**

```ts
import { Y, type Layout } from './layout';

/**
 * Secret mode's sky (spec 2026-10-08 secret mode §2): three aurora curtains baked once per layout at a quarter of the
 * resolution (the upscale softens them for free), drawn each frame with one drawImage apiece, drifting, shimmering and
 * breathing slowly; and the sweep that brings the aurora in over the sky, or takes it away.
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Sprite px per device px. */
export const RES = 0.25;
/** A sprite spans this many viewport widths, so its drift never shows an end. */
export const SPAN = 1.6;
/** The furthest a curtain drifts either way, in viewport widths. */
export const DRIFT = 0.12;
export const SWEEP_MS = 1200;
/** Reduced motion: a crossfade instead of the sweep. */
export const SWEEP_FADE_MS = 300;

export interface Ribbon {
  rgb: string;
  /** Top and height, as fractions of the horizon's height. */
  top: number;
  height: number;
  /** Folds across the sprite. */
  waves: number;
  alpha: number;
  phase: number;
  driftMs: number;
  shimmerMs: number;
  breathMs: number;
}

export const RIBBONS: readonly Ribbon[] = [
  { rgb: '92,255,170', top: 0.06, height: 0.42, waves: 1.7, alpha: 0.55, phase: 0, driftMs: 41_000, shimmerMs: 5_300, breathMs: 9_700 },
  { rgb: '70,214,236', top: 0.14, height: 0.34, waves: 2.6, alpha: 0.4, phase: 2.1, driftMs: 53_000, shimmerMs: 7_100, breathMs: 12_100 },
  { rgb: '170,120,255', top: 0, height: 0.3, waves: 1.2, alpha: 0.36, phase: 4.2, driftMs: 67_000, shimmerMs: 8_900, breathMs: 15_300 },
];

/** Curtains per quality tier: 3, then 2 (green, teal), then 1 (green). */
export const ribbonCount = (tier: number): number => (tier >= 3 ? 1 : tier >= 2 ? 2 : 3);

export interface SweepFrame {
  /** How much of the height (from the top) shows the aurora, 0..1. */
  cover: number;
  /** The aurora's opacity there (a crossfade under reduced motion). */
  alpha: number;
  /** The seam's glow at the sweep's edge, 0..1. */
  edge: number;
  done: boolean;
}

/** The sweep `t` ms in (negative: not started yet). `down` brings the aurora in, `up` takes it away. */
export function sweepFrame(t: number, dir: 'down' | 'up', reduced: boolean, out: SweepFrame = { cover: 0, alpha: 1, edge: 0, done: false }): SweepFrame {
  if (reduced) {
    const k = clamp01(t / SWEEP_FADE_MS);
    out.cover = 1;
    out.alpha = dir === 'down' ? k : 1 - k;
    out.edge = 0;
    out.done = t >= SWEEP_FADE_MS;
    return out;
  }
  const k = clamp01(t / SWEEP_MS);
  const e = easeInOutCubic(k);
  out.cover = dir === 'down' ? e : 1 - e;
  out.alpha = 1;
  out.edge = Math.sin(Math.PI * k);
  out.done = t >= SWEEP_MS;
  return out;
}

/** One curtain into a sprite: rays of light over a bright, wavy lower hem, fading up into the sky and out at both ends. */
function paintCurtain(c: CanvasRenderingContext2D, w: number, h: number, R: Ribbon): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(${R.rgb},0)`);
  g.addColorStop(0.55, `rgba(${R.rgb},0.28)`);
  g.addColorStop(0.86, `rgba(${R.rgb},1)`);
  g.addColorStop(1, `rgba(${R.rgb},0)`);
  c.fillStyle = g;
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const lift = 0.22 * (0.5 + 0.5 * Math.sin(TAU * u * R.waves + R.phase));
    const rays = 0.45 + 0.55 * Math.sin(TAU * u * R.waves * 4.3 + 2 * R.phase) ** 2;
    c.globalAlpha = rays * Math.min(1, u / 0.12, (1 - u) / 0.12);
    c.setTransform(1, 0, 0, 1, 0, -lift * h);
    c.fillRect(x, 0, 1, h);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
}

export class Aurora {
  private sprites: HTMLCanvasElement[] = [];
  private builtFor: Layout | null = null;
  /** The sweep's seam: a 1×64 glow strip, made on first use (null: no 2D context). */
  private seam: HTMLCanvasElement | null | undefined;

  /** The curtains, in screen space (the caller sets a CSS px transform), additive. `alpha` scales them (a crossfade). */
  draw(c: CanvasRenderingContext2D, L: Layout, now: number, tier: number, reduced: boolean, alpha = 1): void {
    if (this.builtFor !== L) this.build(L);
    const hz = Y(L, 10.05);
    const t = reduced ? 0 : now;
    const n = Math.min(ribbonCount(tier), this.sprites.length);
    const op = c.globalCompositeOperation;
    const a0 = c.globalAlpha;
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < n; k++) {
      const R = RIBBONS[k];
      const drift = Math.sin((TAU * t) / R.driftMs + R.phase) * DRIFT * L.w;
      const shimmer = 0.78 + 0.22 * Math.sin((TAU * t) / R.shimmerMs + R.phase);
      const breath = 1 + 0.06 * Math.sin((TAU * t) / R.breathMs + 1.3 * R.phase);
      const h = hz * R.height * breath;
      c.globalAlpha = alpha * R.alpha * shimmer;
      // The hem stays put; the curtain breathes upward from it.
      c.drawImage(this.sprites[k], -0.3 * L.w + drift, hz * (R.top + R.height) - h, SPAN * L.w, h);
    }
    c.globalCompositeOperation = op;
    c.globalAlpha = a0;
  }

  /** The glowing seam along the sweep's edge, `y` in CSS px, `k` its strength 0..1. */
  drawSeam(c: CanvasRenderingContext2D, L: Layout, y: number, k: number): void {
    if (k <= 0) return;
    if (this.seam === undefined) this.seam = makeSeam();
    if (!this.seam) return;
    const op = c.globalCompositeOperation;
    const a0 = c.globalAlpha;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = k;
    c.drawImage(this.seam, 0, y - 0.8 * L.s, L.w, 1.6 * L.s);
    c.globalCompositeOperation = op;
    c.globalAlpha = a0;
  }

  private build(L: Layout): void {
    for (const s of this.sprites) s.width = s.height = 0;
    this.sprites = [];
    this.builtFor = L;
    const hz = Y(L, 10.05);
    for (const R of RIBBONS) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(8, Math.ceil(SPAN * L.w * L.dpr * RES));
      cv.height = Math.max(8, Math.ceil(hz * R.height * L.dpr * RES));
      const c = cv.getContext('2d');
      if (!c) break;
      paintCurtain(c, cv.width, cv.height, R);
      this.sprites.push(cv);
    }
  }
}

function makeSeam(): HTMLCanvasElement | null {
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 64;
  const c = cv.getContext('2d');
  if (!c) return null;
  const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(140,255,220,0)');
  g.addColorStop(0.5, 'rgba(140,255,220,.55)');
  g.addColorStop(1, 'rgba(140,255,220,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 1, 64);
  return cv;
}
```

- [ ] **Step 7: Run them to verify they pass**

Run: `npx vitest run tests/unit/render/scenes.test.ts tests/unit/render/aurora.test.ts`
Expected: PASS.

- [ ] **Step 8: The sweep and the aurora pass in the renderer**

In `src/render/renderer.ts`:

```ts
import { Aurora, sweepFrame, type SweepFrame } from './aurora';
```

Fields (the backdrop is no longer `readonly`: a sweep swaps it):

```ts
  private bg = document.createElement('canvas');
  /** Secret mode's curtains (spec 2026-10-08 secret mode §2). */
  private readonly aurora = new Aurora();
  /** A sky sweep in progress (secret mode on or off by hand), with the backdrop it is leaving. */
  private sweep: { from: HTMLCanvasElement; at: number; dir: 'down' | 'up'; reduced: boolean } | null = null;
  /** The last sweep's canvas, emptied: reused by the next sweep. */
  private spare: HTMLCanvasElement | null = null;
  private readonly sweepOut: SweepFrame = { cover: 0, alpha: 1, edge: 0, done: false };
```

Getters, next to `starTop()`:

```ts
  /** Secret mode: the aurora scene is up. */
  get secret(): boolean {
    return this.scene.id === 'aurora';
  }

  /** A sky sweep is under way (the e2e probe). */
  get sweeping(): boolean {
    return this.sweep !== null;
  }
```

`resize`: first line `this.endSweep();` (the loop then resizes `this.bg` as before).

`setScene`:

```ts
  /**
   * Switches the scene. With `sweep` (secret mode switched by hand) and a change into or out of the aurora, the sky
   * sweeps from `sweep.now` (spec §2.4); the tree, presents and garland change at once.
   */
  setScene(scene: Scene, sweep: { now: number; reduced: boolean } | null = null): void {
    if (scene === this.scene) return;
    const crossing = (scene.id === 'aurora') !== (this.scene.id === 'aurora');
    this.endSweep();
    if (sweep && crossing && this.sized) {
      const from = this.bg;
      this.bg = this.spare ?? document.createElement('canvas');
      this.spare = null;
      this.bg.width = from.width;
      this.bg.height = from.height;
      this.sweep = { from, at: sweep.now, dir: scene.id === 'aurora' ? 'down' : 'up', reduced: sweep.reduced };
    }
    this.scene = scene;
    if (this.sized) this.repaint();
  }

  private endSweep(): void {
    if (!this.sweep) return;
    const c = this.sweep.from;
    c.width = c.height = 0; // frees its pixels; the next sweep sizes it again
    this.spare = c;
    this.sweep = null;
  }
```

In `draw`, replace step 1's first lines (from `// 1. Background …` through the `ctx.setTransform(dpr, 0, 0, dpr, 0, 0);` that follows `drawImage(this.bg, 0, 0)`) with:

```ts
    // 1. Background (screen space) + dynamic back layers. Secret mode adds the aurora's curtains; a sweep brings them in or out.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const sw = this.sweep;
    const fr = sw ? sweepFrame(now - sw.at, sw.dir, sw.reduced, this.sweepOut) : null;
    if (sw && fr && !fr.done) {
      // The non-aurora sky in full; the aurora's backdrop and curtains over the covered part; the seam at its edge.
      ctx.drawImage(sw.dir === 'down' ? sw.from : this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const y = fr.cover * L.h;
      if (y > 0 && fr.alpha > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, L.w, y);
        ctx.clip();
        ctx.globalAlpha = fr.alpha;
        ctx.drawImage(sw.dir === 'down' ? this.bg : sw.from, 0, 0, L.w, L.h);
        this.aurora.draw(ctx, L, now, tier, f.reducedMotion, fr.alpha);
        ctx.restore();
      }
      this.aurora.drawSeam(ctx, L, y, fr.edge);
    } else {
      if (fr?.done) this.endSweep();
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.secret) this.aurora.draw(ctx, L, now, tier, f.reducedMotion);
    }
```

(The existing `if (sc.light === 'fire') drawFirelight(…)`, embers and back snow follow unchanged.)

- [ ] **Step 9: The page chrome**

`src/styles.css`, after the `body[data-scene='frost'] { … }` block:

```css
body[data-scene='aurora'] { --ink: #eef0ff; --accent: #9fe7ff; --panel: rgba(12, 12, 40, 0.74); }
```

`src/ui/radio.css`, after the `body[data-scene='midnight'] .radio .art` rule:

```css
body[data-scene='aurora'] .radio .art { background: radial-gradient(70% 70% at 50% 62%, rgba(120, 230, 255, 0.24), transparent 70%), linear-gradient(160deg, #1b1650, #070a1e); }
```

- [ ] **Step 10: Typecheck, the unit suite and the build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS. (The app still calls `setScene(SCENES[id])`; Task 6 switches it to `sceneFor`.)

- [ ] **Step 11: Commit**

```bash
git add src/render/scenes.ts src/render/aurora.ts src/render/paint-background.ts src/render/paint-tree.ts src/render/presents.ts src/render/renderer.ts src/styles.css src/ui/radio.css tests/unit/render/scenes.test.ts tests/unit/render/aurora.test.ts
git commit -m "feat(render): the aurora scene: cached backdrop, quarter-res curtains, the sky sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Luke's face: ornament, present, garland bulb, confetti

**Files:**
- Create: `src/render/faces.ts`, `src/render/face-sprites.ts`
- Modify: `src/render/topper.ts`, `src/render/bulbs.ts`, `src/render/presents.ts`, `src/render/garland.ts`, `src/render/effects.ts`, `src/render/renderer.ts`
- Test: `tests/unit/render/faces.test.ts`, `tests/unit/render/face-sprites.test.ts`, `tests/unit/render/face-draw.test.ts`, `tests/unit/render/confetti.test.ts`

**Interfaces:**
- Consumes: `Renderer.secret` (Task 3); `AURORA` (Task 3, tests); `degree` (`src/core/dirs.ts`); `garlandGeometry`, `GarlandGeometry`; `placePresents`, `Gift`.
- Produces:
  - `src/render/faces.ts`: `FACE_ORNAMENT_H = 0.56`, `FACE_GARLAND_H = 1.15`, `FACE_CONFETTI_PX = 29`, `solutionHash(solution)`, `faceBulbTile(solution, ids): number`, `faceGiftIndex(gifts): number`, `faceGarlandIndex(geo): number`.
  - `src/render/face-sprites.ts`: `type FaceSlot = 'ornament' | 'garland' | 'confetti' | 'paper'`; `class FaceSprites { constructor(image: () => HTMLImageElement | null); get ready(): boolean; get(slot, size, lit): HTMLCanvasElement | null }`.
  - `src/render/topper.ts`: exported `resample`, `dimmed`, `cacheHeight`, `cacheWidth`; `Topper.image: HTMLImageElement | null`.
  - `src/render/bulbs.ts`: `drawFaceBulb(c, b, amt, s, sc, sprite)`.
  - `src/render/presents.ts`: `Paper.pattern` gains `'face'`; `FACE_PAPER`; `Presents.layout(L, grid, sc, faces?: FaceSprites | null)`; `Presents.faceIndex`.
  - `src/render/garland.ts`: `Garland.face`; `Garland.paint(sc, dpr, face = -1)`; `Garland.drawFace(c, now, winAt, reduced, lit, dim, bob)`.
  - `src/render/effects.ts`: `HEAD_FLECK = 4`; `Confetti.draw(…, sc, head: HTMLCanvasElement | null = null)`.
  - `src/render/renderer.ts`: `readonly faces: FaceSprites`; `faceInfo(): { tile: number; gift: number; garland: number }`.

- [ ] **Step 1: Write the failing pick tests**

Create `tests/unit/render/faces.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { degree } from '../../../src/core/dirs';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { faceBulbTile, faceGarlandIndex, faceGiftIndex, solutionHash } from '../../../src/render/faces';
import { garlandGeometry } from '../../../src/render/garland';
import { computeLayout } from '../../../src/render/layout';
import { placePresents } from '../../../src/render/presents';

const trees = Array.from({ length: 40 }, (_, k) => Board.random(GRID, mulberry32(k + 1)));

describe('faceBulbTile', () => {
  it("is one of the tree's bulbs, the same every time for the same tree", () => {
    for (const b of trees) {
      const t = faceBulbTile(b.solution, GRID.ids);
      expect(degree(b.solution[t])).toBe(1);
      expect(faceBulbTile([...b.solution], [...GRID.ids])).toBe(t);
    }
  });
  it('spreads over the bulbs from tree to tree', () => {
    expect(new Set(trees.map((b) => faceBulbTile(b.solution, GRID.ids))).size).toBeGreaterThanOrEqual(15);
  });
  it('hashes with FNV-1a over the low four bits of each tile', () => {
    expect(solutionHash([])).toBe(0x811c9dc5);
    expect(solutionHash([16 + 3])).toBe(solutionHash([3]));
    expect(faceBulbTile([], [])).toBe(-1);
  });
});

describe('faceGiftIndex', () => {
  it('picks the gift with the largest front face, on phones and desktop', () => {
    for (const [w, h] of [[390, 844], [1440, 900]] as const) {
      const gifts = placePresents(computeLayout(w, h, 2), GRID);
      const k = faceGiftIndex(gifts);
      expect(gifts[k].w * gifts[k].h).toBe(Math.max(...gifts.map((g) => g.w * g.h)));
    }
  });
  it('the first on a tie; -1 with no gifts', () => {
    expect(faceGiftIndex([{ w: 2, h: 1 }, { w: 1, h: 2 }])).toBe(0);
    expect(faceGiftIndex([])).toBe(-1);
  });
});

describe('faceGarlandIndex', () => {
  it("is the right swag's bulb nearest the swag's middle, hanging nearly straight down", () => {
    for (const [w, chrome] of [[390, 46], [1440, 58]] as const) {
      const geo = garlandGeometry(w, 40, chrome);
      const k = faceGarlandIndex(geo);
      const [a, b] = geo.swags[1];
      const mid = (a + b) / 2;
      expect(geo.bulbs[k].x).toBeGreaterThanOrEqual(a);
      expect(Math.abs(geo.bulbs[k].angle)).toBeLessThan(0.2);
      for (const bulb of geo.bulbs) if (bulb.x >= a) expect(Math.abs(bulb.x - mid)).toBeGreaterThanOrEqual(Math.abs(geo.bulbs[k].x - mid));
    }
  });
});
```

- [ ] **Step 2: Write the failing sprite and drawing tests**

Create `tests/unit/render/face-sprites.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FaceSprites } from '../../../src/render/face-sprites';

const img = { naturalWidth: 240, naturalHeight: 256 } as HTMLImageElement;
let made = 0;

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  made = 0;
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') made++;
    return create(tag);
  }) as typeof document.createElement);
  const ctx = new Proxy(
    { getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => undefined), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
});

it('nothing until the sticker has loaded', () => {
  const f = new FaceSprites(() => null);
  expect(f.ready).toBe(false);
  expect(f.get('ornament', 40, true)).toBeNull();
});

it('caches a lit and a dim copy per slot, in 8 px steps', () => {
  const f = new FaceSprites(() => img);
  expect(f.ready).toBe(true);
  const lit = f.get('ornament', 33, true);
  const after = made;
  expect(lit?.height).toBe(40);
  const dim = f.get('ornament', 39, false);
  expect(dim).not.toBe(lit);
  expect(f.get('ornament', 38, true)).toBe(lit);
  expect(made).toBe(after);
  expect(f.get('ornament', 41, true)?.height).toBe(48);
  expect(made).toBeGreaterThan(after);
  expect(f.get('garland', 33, true)).not.toBe(f.get('ornament', 41, true));
});
```

Create `tests/unit/render/face-draw.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { drawFaceBulb } from '../../../src/render/bulbs';
import type { FaceSprites } from '../../../src/render/face-sprites';
import { faceGarlandIndex, faceGiftIndex } from '../../../src/render/faces';
import { Garland } from '../../../src/render/garland';
import { computeLayout } from '../../../src/render/layout';
import { FACE_PAPER, Presents, placePresents } from '../../../src/render/presents';
import { AURORA } from '../../../src/render/scenes';

function recorder(names: string[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (..._: unknown[]) => {
        names.push(String(k));
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
const sprite = { width: 30, height: 32 } as HTMLCanvasElement;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([])) as never);
});
afterEach(() => vi.restoreAllMocks());

it('the face ornament: the socket and one sticker, never the glass', () => {
  const names: string[] = [];
  drawFaceBulb(recorder(names), 1, 1, 40, AURORA, sprite);
  expect(names.filter((n) => n === 'drawImage')).toHaveLength(1);
  expect(names).toContain('roundRect');
  expect(names).not.toContain('arc');
});

describe('the garland face', () => {
  it('dim while its bulb is dark, lit once it lights, one drawImage either way', () => {
    const g = new Garland();
    g.layout(390, 40, 46);
    g.face = faceGarlandIndex(g.geo);
    const dark: string[] = [];
    g.drawFace(recorder(dark), 1000, null, false, sprite, sprite, 0);
    expect(dark.filter((n) => n === 'drawImage')).toHaveLength(1);
    g.update(1, 1000);
    const lit: string[] = [];
    g.drawFace(recorder(lit), 2000, null, false, sprite, sprite, 0);
    expect(lit.filter((n) => n === 'drawImage')).toHaveLength(1);
  });
  it('draws nothing without a face bulb or a sticker', () => {
    const g = new Garland();
    g.layout(390, 40, 46);
    const names: string[] = [];
    g.drawFace(recorder(names), 1000, null, false, sprite, sprite, 0);
    g.face = 3;
    g.drawFace(recorder(names), 1000, null, false, null, null, 0);
    expect(names).not.toContain('drawImage');
  });
});

describe('the face present', () => {
  const L = computeLayout(390, 844, 2);
  it('wraps the chosen gift in face paper, both passes printed from the sticker', () => {
    const get = vi.fn(() => sprite);
    const p = new Presents();
    p.layout(L, GRID, AURORA, { ready: true, get } as unknown as FaceSprites);
    expect(p.faceIndex).toBe(faceGiftIndex(placePresents(L, GRID)));
    expect(p.gifts[p.faceIndex].paper).toBe(FACE_PAPER);
    expect(get.mock.calls.map((c) => [c[0], c[2]])).toEqual([['paper', false], ['paper', true]]);
  });
  it('plain paper without the sticker', () => {
    const p = new Presents();
    p.layout(L, GRID, AURORA, null);
    expect(p.faceIndex).toBe(-1);
    expect(p.gifts.some((g) => g.paper === FACE_PAPER)).toBe(false);
  });
});
```

Append to `tests/unit/render/confetti.test.ts` (add imports `computeLayout` from `../../../src/render/layout` and `SCENES` from `../../../src/render/scenes`):

```ts
it('secret mode: every gold fleck falls as a mini head, the snow stays snow', () => {
  const log = (names: string[]) =>
    new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' } as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : (..._: unknown[]) => (names.push(String(k)), k === 'createRadialGradient' ? { addColorStop() {} } : undefined)),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
  const L = computeLayout(1280, 800, 2);
  const c = new Confetti();
  const plain: string[] = [];
  const heads: string[] = [];
  c.draw(log(plain), L, 4000, 1000, 1, SCENES.midnight);
  c.draw(log(heads), L, 4000, 1000, 1, SCENES.midnight, { width: 30, height: 32 } as HTMLCanvasElement);
  const n = (names: string[], k: string) => names.filter((x) => x === k).length;
  // Every radial glow (snow, a fleck's glint) is one gradient plus one fillRect; a gold fleck is one more fillRect.
  const gold = n(plain, 'fillRect') - n(plain, 'createRadialGradient');
  expect(n(plain, 'drawImage')).toBe(0);
  expect(gold).toBeGreaterThan(20);
  expect(n(heads, 'drawImage')).toBe(gold);
  // Only the snow's glows are left: no gold fills and no glints.
  expect(n(heads, 'fillRect')).toBe(n(heads, 'createRadialGradient'));
  expect(n(heads, 'createRadialGradient')).toBeLessThanOrEqual(n(plain, 'createRadialGradient'));
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/render/faces.test.ts tests/unit/render/face-sprites.test.ts tests/unit/render/face-draw.test.ts tests/unit/render/confetti.test.ts`
Expected: FAIL (missing modules and exports).

- [ ] **Step 4: Write `src/render/faces.ts`**

```ts
import { degree } from '../core/dirs';
import type { GarlandGeometry } from './garland';

/**
 * Where Luke's face hides in secret mode (spec 2026-10-08 secret mode §3): one tree bulb, one present, one garland
 * bulb, each picked deterministically.
 */

/** The head's height on the face ornament, in tiles. */
export const FACE_ORNAMENT_H = 0.56;
/** The head's height on the garland, in bulb sizes. */
export const FACE_GARLAND_H = 1.15;
/** The confetti's mini heads come from one cached size: the largest fleck (4.2 CSS px × HEAD_FLECK) at the largest zoom (1.7), rounded up. */
export const FACE_CONFETTI_PX = 29;

/** FNV-1a 32-bit over the low four bits of each tile of the solution: every tree, seeded, local or resumed, hashes the same. */
export function solutionHash(solution: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of solution) h = Math.imul(h ^ (v & 15), 0x01000193) >>> 0;
  return h;
}

/** The face ornament: one of the tree's bulbs (degree-1 tiles of the solution, in `ids` order), picked by the hash; -1 with none. */
export function faceBulbTile(solution: readonly number[], ids: readonly number[]): number {
  const bulbs = ids.filter((i) => degree(solution[i]) === 1);
  return bulbs.length ? bulbs[solutionHash(solution) % bulbs.length] : -1;
}

/** The present in face paper: the one with the largest front face (the first on a tie); -1 with none. */
export function faceGiftIndex(gifts: readonly { w: number; h: number }[]): number {
  let best = -1;
  let area = -1;
  gifts.forEach((g, k) => {
    if (g.w * g.h > area) {
      area = g.w * g.h;
      best = k;
    }
  });
  return best;
}

/** The garland's face: the right swag's bulb nearest that swag's middle (its low point, clear of the star); the first on a tie. */
export function faceGarlandIndex(geo: Pick<GarlandGeometry, 'bulbs' | 'swags'>): number {
  const [a, b] = geo.swags[1];
  const mid = (a + b) / 2;
  let best = -1;
  let d = Number.POSITIVE_INFINITY;
  geo.bulbs.forEach((bulb, k) => {
    if (bulb.x >= a && Math.abs(bulb.x - mid) < d) {
      d = Math.abs(bulb.x - mid);
      best = k;
    }
  });
  return best;
}
```

- [ ] **Step 5: Export the topper's sticker helpers, and its image**

In `src/render/topper.ts`, make these `export function`/`export const`: `cacheHeight`, `cacheWidth`, `resample`, `dimmed` (no other change to them). Add to `Topper`, after `get ready()`:

```ts
  /** The loaded sticker, for secret mode's other faces (src/render/face-sprites.ts); null until it loads or if it can't be drawn. */
  get image(): HTMLImageElement | null {
    return this.broken ? null : this.img;
  }
```

- [ ] **Step 6: Write `src/render/face-sprites.ts`**

```ts
import { cacheHeight, cacheWidth, dimmed, resample } from './topper';

/** Each place a face shows keeps its own size. */
export type FaceSlot = 'ornament' | 'garland' | 'confetti' | 'paper';

interface Cached {
  h: number;
  lit: HTMLCanvasElement;
  dim: HTMLCanvasElement;
}

/**
 * Secret mode's faces (spec 2026-10-08 secret mode §3), from the topper's sticker: per slot a lit and a dimmed (night)
 * copy at the size it is drawn, in 8 px steps like the topper's own, so frames reuse them and a zoom rebuilds rarely.
 */
export class FaceSprites {
  private readonly cache = new Map<FaceSlot, Cached>();
  private source: HTMLImageElement | null = null;
  /** Building a copy failed (no 2D context): faces fall back for good, as the topper does. */
  private broken = false;

  constructor(private readonly image: () => HTMLImageElement | null) {}

  get ready(): boolean {
    return !this.broken && this.image() !== null;
  }

  /** The sticker `size` device px tall (capped at its own), lit or dimmed; null until it has loaded. */
  get(slot: FaceSlot, size: number, lit: boolean): HTMLCanvasElement | null {
    const img = this.image();
    if (!img || this.broken) return null;
    if (img !== this.source) {
      for (const c of this.cache.values()) c.lit.width = c.lit.height = c.dim.width = c.dim.height = 0;
      this.cache.clear();
      this.source = img;
    }
    const h = cacheHeight(img, size);
    let c = this.cache.get(slot);
    if (!c || c.h !== h) {
      try {
        const l = resample(img, cacheWidth(img, h), h);
        const next = { h, lit: l, dim: dimmed(l, false) };
        if (c) c.lit.width = c.lit.height = c.dim.width = c.dim.height = 0;
        this.cache.set(slot, next);
        c = next;
      } catch {
        this.broken = true;
        return null;
      }
    }
    return lit ? c.lit : c.dim;
  }
}
```

- [ ] **Step 7: The face ornament**

Append to `src/render/bulbs.ts` (import `FACE_ORNAMENT_H` from `./faces`):

```ts
/**
 * Secret mode's face ornament (spec 2026-10-08 secret mode §3.2): the socket still faces the wire, and Luke's head,
 * upright, takes the glass's place: `sprite` is dimmed when unlit, lit (at the glass's opacity) when lit.
 */
export function drawFaceBulb(c: CanvasRenderingContext2D, b: number, amt: number, s: number, sc: Scene, sprite: HTMLCanvasElement): void {
  const swell = amt > 1 ? 1 + (amt - 1) * 0.35 : 1;
  const r = s * 0.2 * swell;
  const a = bulbAngle(b);
  c.save();
  c.rotate(a);
  c.fillStyle = sc.socket;
  c.beginPath();
  c.roundRect(r * 0.55, -r * 0.38, r * 0.75, r * 0.76, r * 0.12);
  c.fill();
  c.restore();
  const h = s * FACE_ORNAMENT_H * swell;
  const w = (h * sprite.width) / sprite.height;
  const gx = -Math.cos(a) * r * 0.12;
  const gy = -Math.sin(a) * r * 0.12;
  const a0 = c.globalAlpha;
  if (amt > 0) c.globalAlpha = a0 * Math.min(1, 0.35 + amt);
  c.drawImage(sprite, gx - w / 2, gy - h * 0.55, w, h);
  c.globalAlpha = a0;
}
```

- [ ] **Step 8: The face present**

In `src/render/presents.ts`:

```ts
import type { FaceSprites } from './face-sprites';
import { faceGiftIndex } from './faces';
```

`Paper.pattern: 'plain' | 'stripe' | 'dots' | 'face';` and after `PAPERS`:

```ts
/** Secret mode's present (spec 2026-10-08 secret mode §3.2): midnight-indigo paper printed with Luke's head, an ice ribbon. */
export const FACE_PAPER: Paper = { base: '#22275e', ribbon: '#d8ecff', pattern: 'face', ink: '#22275e' };
```

`paperPattern` takes the print and handles `'face'`:

```ts
/** Pattern printed on the paper, clipped to the current path. `print`: the sticker, for the face paper. */
function paperPattern(c: CanvasRenderingContext2D, g: Gift, t: Tone, face: Face, box: Rect, print: HTMLCanvasElement | null = null): void {
  const p = g.paper;
  if (p.pattern === 'plain' || (p.pattern === 'face' && !print)) return;
  c.save();
  c.clip();
  if (p.pattern === 'face' && print) {
    printFaces(c, g, box, print);
    c.restore();
    return;
  }
  // … the stripe and dots code is unchanged …
}

/** The face paper: the sticker on a staggered grid, every other row offset by half a step. */
function printFaces(c: CanvasRenderingContext2D, g: Gift, box: Rect, print: HTMLCanvasElement): void {
  const step = Math.max(8, g.w * 0.26);
  const fh = step * 0.78;
  const fw = (fh * print.width) / print.height;
  c.globalAlpha = 0.92;
  let row = 0;
  for (let y = box.y0 + step * 0.45; y < box.y1 + fh / 2; y += step * 0.82, row++) {
    for (let x = box.x0 + (row % 2 ? step / 2 : 0); x < box.x1 + fw / 2; x += step) c.drawImage(print, x - fw / 2, y - fh / 2, fw, fh);
  }
}
```

`paintBox(c, g, t, pass, print: HTMLCanvasElement | null = null)` passes `print` as the last argument of each of its four `paperPattern(…)` calls.

The class:

```ts
  /** The gift in face paper (secret mode), or -1. */
  faceIndex = -1;

  /** Places and pre-renders the gifts. Call on layout or scene change. `faces`: secret mode, with the sticker loaded. */
  layout(L: Layout, grid: Grid, sc: Scene, faces: FaceSprites | null = null): void {
    for (const sp of this.sprites) sp.base.width = sp.light.width = 0;
    this.gifts = placePresents(L, grid);
    this.faceIndex = faces?.ready ? faceGiftIndex(this.gifts) : -1;
    if (this.faceIndex >= 0) this.gifts[this.faceIndex] = { ...this.gifts[this.faceIndex], paper: FACE_PAPER };
    const lt = lighting(sc);
    this.sprites = this.gifts.map((g) => this.render(g, L, sc, lt, faces));
  }
```

and in `render(g, L, sc, lt, faces: FaceSprites | null)`, inside the pass loop before `paintBox`:

```ts
      // The base pass is the dark ambient (the dimmed sticker); the light pass adds the tree's light (the lit one).
      const print = g.paper.pattern === 'face' && faces ? faces.get('paper', Math.max(8, g.w * 0.26) * 0.78 * dpr, pass === 'light') : null;
      paintBox(bc, g, new Tone(lt, pass), pass, print);
```

- [ ] **Step 9: The garland face**

In `src/render/garland.ts` (import `FACE_GARLAND_H` from `./faces`):

```ts
  /** Secret mode: the bulb whose glass is Luke's head (spec 2026-10-08 secret mode §3), or -1. */
  face = -1;
```

`paint(sc: Scene, dpr: number, face = -1): void` sets `this.face = face;` first. In `paintBack`, draw the glass only for other bulbs: `if (k !== this.face) this.glassUnlit(c, sc.bulbs[k % sc.bulbs.length], g.size, day);`. In `drawLit`: `if (a <= 0 || k === this.face) continue;`. Add:

```ts
  /**
   * Secret mode: Luke's head hangs under the face bulb's socket in place of its glass, dimmed while the bulb is dark and
   * lit on top as it lights; `bob` (bulb sizes, down) moves it gently and on the beat. Screen space, CSS px transform.
   */
  drawFace(c: CanvasRenderingContext2D, now: number, winAt: number | null, reduced: boolean, lit: HTMLCanvasElement | null, dim: HTMLCanvasElement | null, bob: number): void {
    const k = this.face;
    if (k < 0 || !lit || !dim) return;
    const z = this.geo.size;
    const b = this.geo.bulbs[k];
    const a = this.amount(k, now, winAt, reduced);
    const h = FACE_GARLAND_H * z;
    const w = (h * lit.width) / lit.height;
    const top = 0.3 * z + bob * z;
    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.angle);
    if (a < 1) c.drawImage(dim, -w / 2, top, w, h);
    if (a > 0) {
      c.globalAlpha = Math.min(1, a);
      c.drawImage(lit, -w / 2, top, w, h);
    }
    c.restore();
  }
```

- [ ] **Step 10: The confetti's mini heads**

In `src/render/effects.ts`, after `CONFETTI_COUNT`:

```ts
/** Secret mode: each gold fleck falls as a mini head this many times its size (spec 2026-10-08 secret mode §6). */
export const HEAD_FLECK = 4;
```

`Confetti.draw` gains `head: HTMLCanvasElement | null = null` as its last parameter. In the loop, after the snow branch's `continue` and the existing `const face = Math.abs(Math.cos(f.tumble * tt + f.ph));` line:

```ts
      if (head) {
        // A mini head turning like a coin as it tumbles: foreshortened across, spinning slower than a fleck so the face reads.
        const hh = size * HEAD_FLECK;
        const hw = (hh * head.width) / head.height;
        c.translate(x, y);
        c.rotate((f.spin * tt + f.ph) * 0.35);
        c.scale(Math.max(0.12, face), 1);
        c.globalAlpha = a;
        c.drawImage(head, -hw / 2, -hh / 2, hw, hh);
        c.globalAlpha = 1;
        continue;
      }
```

- [ ] **Step 11: Wire the faces into the renderer**

In `src/render/renderer.ts`:

```ts
import { drawBulb, drawBulbGlint, drawBulbHalo, drawFaceBulb } from './bulbs';
import { FaceSprites } from './face-sprites';
import { FACE_CONFETTI_PX, FACE_GARLAND_H, FACE_ORNAMENT_H, faceBulbTile, faceGarlandIndex } from './faces';
```

Fields, declared after `topper`:

```ts
  /** Secret mode's faces, from the topper's sticker (spec 2026-10-08 secret mode §3). */
  readonly faces = new FaceSprites(() => this.topper.image);
  /** The presents and garland were last laid out with the faces. */
  private faced = false;
  /** The face ornament's tile, worked out once per tree. */
  private faceBoard: Board | null = null;
  private faceTile = -1;
```

`repaint` lays the faces out:

```ts
  private repaint(): void {
    paintBackground(ctx2d(this.bg), this.layout, this.scene);
    paintTree(ctx2d(this.tree), this.layout, this.scene);
    this.layFaces();
  }

  /** Presents and garland: in secret mode, once the sticker has loaded, with the face paper and the face bulb. */
  private layFaces(): void {
    const faces = this.secret && this.faces.ready ? this.faces : null;
    this.presents.layout(this.layout, GRID, this.scene, faces);
    this.garland.paint(this.scene, this.layout.dpr, faces ? faceGarlandIndex(this.garland.geo) : -1);
    this.faced = faces !== null;
  }

  /** Where the faces are (the e2e probe): the ornament's tile, the present and the garland bulb, or -1. */
  faceInfo(): { tile: number; gift: number; garland: number } {
    return { tile: this.secret && this.faces.ready ? this.faceTile : -1, gift: this.presents.faceIndex, garland: this.garland.face };
  }
```

At the start of `draw`, after `vis.prune(now);`:

```ts
    // Secret mode's faces: lay the presents and garland out again once the sticker arrives; one ornament per tree.
    const secret = this.secret;
    if (secret && !this.faced && this.faces.ready) this.layFaces();
    if (secret && board !== this.faceBoard) {
      this.faceBoard = board;
      this.faceTile = faceBulbTile(board.solution, GRID.ids);
    }
    const faceTile = secret && this.faces.ready ? this.faceTile : -1;
    const facePx = FACE_ORNAMENT_H * s * dpr * cam.scale;
```

Pass 1, the unlit bulb:

```ts
      if (isBulb) {
        const face = i === faceTile ? this.faces.get('ornament', facePx, false) : null;
        if (face) drawFaceBulb(ctx, shown, 0, s, sc, face);
        else drawBulb(ctx, shown, sc.bulbs[board.colors[i]], 0, s, sc, style);
      }
```

Pass 2, the lit bulb:

```ts
      if (degree(board.solution[i]) === 1 && q >= 1) {
        const amt = this.bulbAmount(f, i) * alpha;
        const face = i === faceTile ? this.faces.get('ornament', facePx, true) : null;
        if (face) drawFaceBulb(ctx, board.bits[i], amt, s, sc, face);
        else drawBulb(ctx, board.bits[i], sc.bulbs[board.colors[i]], amt, s, sc, style);
        if (!f.reducedMotion) drawBulbGlint(ctx, now - (vis.litStart[i] + TILE_FILL_MS), s);
      }
```

Step 6 (garland, snow, confetti):

```ts
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.garland.drawLit(ctx, sc, now, f.winAt, f.reducedMotion);
    if (secret) {
      const px = FACE_GARLAND_H * this.garland.geo.size * dpr;
      this.garland.drawFace(ctx, now, f.winAt, f.reducedMotion, this.faces.get('garland', px, true), this.faces.get('garland', px, false), 0);
    }
    this.snow.draw(ctx, L, sc, true, motionDt, now, density);
    if (!f.reducedMotion) this.confetti.draw(ctx, L, now, f.winAt, density, sc, secret ? this.faces.get('confetti', FACE_CONFETTI_PX * dpr, true) : null);
```

- [ ] **Step 12: Run the tests, typecheck, build**

Run: `npx vitest run tests/unit/render && npm run typecheck && npm run build`
Expected: PASS (new and existing render tests).

- [ ] **Step 13: Commit**

```bash
git add src/render/faces.ts src/render/face-sprites.ts src/render/topper.ts src/render/bulbs.ts src/render/presents.ts src/render/garland.ts src/render/effects.ts src/render/renderer.ts tests/unit/render/faces.test.ts tests/unit/render/face-sprites.test.ts tests/unit/render/face-draw.test.ts tests/unit/render/confetti.test.ts
git commit -m "feat(render): Luke's face in secret mode: one ornament, one present, one garland bulb, the confetti

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: On the beat: tracker, nod, pulse, palette step, bob

**Files:**
- Create: `src/radio/beat.ts`, `src/render/beat-fx.ts`
- Modify: `src/radio/lightshow.ts`, `src/render/topper.ts`, `src/render/renderer.ts`
- Test: `tests/unit/radio/beat.test.ts`, `tests/unit/render/beat-fx.test.ts`, `tests/unit/render/topper-draw.test.ts`

**Interfaces:**
- Consumes: `bandEnergies`, `LightShow` (`src/radio/lightshow.ts`); `Garland.drawFace` (Task 4).
- Produces:
  - `src/radio/beat.ts`: `BEAT`, `beatStrength(e, avg): number`, `class BeatTracker { at: number; strength: number; strong: number; update(e: number, now: number): boolean; reset(): void }`.
  - `src/radio/lightshow.ts`: `LightShow.beat: BeatTracker` (fed by `sample`).
  - `src/render/beat-fx.ts`: `NOD_MS = 260`, `NOD_DIP = 0.09`, `NOD_SQUASH = 0.03`, `nodPulse(t)`, `beatPulse(t, strength, reduced)`, `garlandBob(now, at, strength, reduced)`.
  - `src/render/topper.ts`: `Topper.nod(at: number, strength: number): void`.
  - `src/render/renderer.ts`: `export interface BeatFrame { at: number; strength: number; hue: number }`; `FrameInput.beat?: BeatFrame`.

- [ ] **Step 1: Write the failing tracker tests**

Create `tests/unit/radio/beat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BEAT, BeatTracker, beatStrength } from '../../../src/radio/beat';

/** Low-band energy for a kick drum: `kick` for the first 60 ms of each beat, `floor` otherwise, sampled at `fps`. */
function kicks(fps: number, ms: number, { bpm = 120, kick = 0.8, floor = 0.15 } = {}): [number, number][] {
  const period = 60_000 / bpm;
  const out: [number, number][] = [];
  for (let k = 0, t = 0; t < ms; k++, t = (k * 1000) / fps) out.push([t, t % period < 60 ? kick : floor]);
  return out;
}
const onsets = (b: BeatTracker, samples: [number, number][]) => samples.filter(([t, e]) => b.update(e, t)).map(([t]) => t);

describe('BeatTracker', () => {
  it('finds every kick after the warm-up, on its first frame', () => {
    const at = onsets(new BeatTracker(), kicks(60, 4000));
    expect(at).toHaveLength(7); // 500 … 3500; the kick at 0 is inside the warm-up
    at.forEach((t, k) => expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60));
  });

  it('finds the same beats at 30 and 60 frames a second', () => {
    const a = onsets(new BeatTracker(), kicks(60, 6000));
    const b = onsets(new BeatTracker(), kicks(30, 6000));
    expect(b).toHaveLength(a.length);
    b.forEach((t, k) => expect(Math.abs(t - a[k])).toBeLessThanOrEqual(34));
  });

  it('keeps 250 ms between beats however fast the kicks come', () => {
    const at = onsets(new BeatTracker(), kicks(60, 3000, { bpm: 300 }));
    expect(at.length).toBeGreaterThan(3);
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(BEAT.refractoryMs);
  });

  it('ignores music too quiet to drive anything', () => {
    expect(onsets(new BeatTracker(), kicks(60, 3000, { kick: 0.05, floor: 0.01 }))).toEqual([]);
  });

  it('counts strong beats, and weak ones as beats but not strong', () => {
    const loud = new BeatTracker();
    const n = onsets(loud, kicks(60, 4000)).length;
    expect(loud.strong).toBe(n);
    expect(loud.strength).toBe(1);
    const soft = new BeatTracker();
    expect(onsets(soft, kicks(60, 4000, { kick: 0.26 })).length).toBeGreaterThan(3);
    expect(soft.strong).toBe(0);
    expect(soft.strength).toBeLessThan(BEAT.strong);
  });

  it('reset and a clock that goes backwards start the warm-up again', () => {
    const b = new BeatTracker();
    onsets(b, kicks(60, 2000));
    b.reset();
    expect(b.update(0.8, 10_000)).toBe(false);
    expect(b.update(0.15, 10_100)).toBe(false);
    expect(b.update(0.8, 10_200)).toBe(false); // still warming up
    expect(b.update(0.8, 5)).toBe(false); // backwards: a new start
  });
});

describe('beatStrength', () => {
  it('0.3 at the threshold, 1 from 2.5 times the average', () => {
    expect(beatStrength(0.13, 0.1)).toBeCloseTo(0.3);
    expect(beatStrength(0.19, 0.1)).toBeCloseTo(0.65);
    expect(beatStrength(0.25, 0.1)).toBeCloseTo(1);
    expect(beatStrength(1, 0.1)).toBe(1);
    expect(beatStrength(0.1, 0)).toBe(1); // a floor under the average
  });
});
```

- [ ] **Step 2: Write the failing effect tests**

Create `tests/unit/render/beat-fx.test.ts`:

```ts
import { expect, it } from 'vitest';
import { NOD_MS, beatPulse, garlandBob, nodPulse } from '../../../src/render/beat-fx';

it('nodPulse: a quick dip to 1 at 30 % and a slower return to 0', () => {
  expect(nodPulse(-1)).toBe(0);
  expect(nodPulse(0)).toBe(0);
  expect(nodPulse(0.3 * NOD_MS)).toBeCloseTo(1);
  expect(nodPulse(NOD_MS)).toBe(0);
  expect(nodPulse(0.15 * NOD_MS)).toBeCloseTo(0.5);
  expect(nodPulse(0.65 * NOD_MS)).toBeCloseTo(0.5);
});

it('beatPulse: a bright flash that fades, gentler under reduced motion', () => {
  expect(beatPulse(-5, 1, false)).toBe(0);
  expect(beatPulse(0, 1, false)).toBeCloseTo(0.6);
  expect(beatPulse(180, 0.5, false)).toBeCloseTo(0.3 * Math.exp(-1));
  expect(beatPulse(0, 1, true)).toBeCloseTo(0.25);
  expect(beatPulse(250, 1, true)).toBeCloseTo(0.25 * Math.exp(-1));
});

it('garlandBob: a gentle idle sway plus a dip on the beat; still under reduced motion', () => {
  for (let t = 0; t < 5000; t += 97) expect(Math.abs(garlandBob(t, Number.NEGATIVE_INFINITY, 0, false))).toBeLessThanOrEqual(0.05);
  const now = 9000;
  expect(garlandBob(now, now - 0.3 * NOD_MS, 1, false) - garlandBob(now, Number.NEGATIVE_INFINITY, 0, false)).toBeCloseTo(0.16);
  expect(garlandBob(now, now - 0.3 * NOD_MS, 1, true)).toBe(0);
});
```

Append to `tests/unit/render/topper-draw.test.ts` (it already has `recorder`, `FakeImage`, `L`, `sc`, `dim`; import `NOD_DIP`, `NOD_MS` from `../../../src/render/beat-fx`):

```ts
describe('the nod (secret mode)', () => {
  it('dips the head on a beat and brings it back; never under reduced motion', async () => {
    const t = new Topper();
    t.set(true);
    await t.load();
    const y = (reduced: boolean, at: number, now: number): number => {
      const calls: Call[] = [];
      t.nod(at, 1);
      t.draw(recorder(calls), L, sc, dim, false, 0, now, null, reduced, 2);
      return calls.find((c) => c.name === 'translate')?.args[1] as number;
    };
    const rest = y(false, Number.NEGATIVE_INFINITY, 5000);
    expect(y(false, 5000 - 0.3 * NOD_MS, 5000) - rest).toBeCloseTo(NOD_DIP * L.s, 5);
    expect(y(false, 5000 - NOD_MS, 5000)).toBeCloseTo(rest, 5);
    expect(y(true, 5000 - 0.3 * NOD_MS, 5000)).toBeCloseTo(rest, 5);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/radio/beat.test.ts tests/unit/render/beat-fx.test.ts tests/unit/render/topper-draw.test.ts`
Expected: FAIL (missing modules; `nod` is not a function).

- [ ] **Step 4: Write `src/radio/beat.ts`**

```ts
/**
 * Secret mode's beat (spec 2026-10-08 secret mode §5.1): onsets in the light show's low band, found as a rise over a
 * short moving average with a time constant (so 30 Hz and 60 Hz frames find the same beats), a 250 ms refractory and a
 * strength. The post-win light show keeps its own BeatDetector.
 */
export const BEAT = { floor: 0.06, rise: 0.035, ratio: 1.3, tauMs: 300, warmupMs: 300, refractoryMs: 250, strong: 0.6 } as const;

/** 0.3 at the threshold (energy = 1.3 × the average), 1 from 2.5 × up. */
export function beatStrength(e: number, avg: number): number {
  const r = e / Math.max(avg, 0.02);
  return Math.min(1, Math.max(0.3, 0.3 + (0.7 * (r - BEAT.ratio)) / (2.5 - BEAT.ratio)));
}

export class BeatTracker {
  /** When the last beat landed (performance.now ms), and its strength 0.3..1. */
  at = Number.NEGATIVE_INFINITY;
  strength = 0;
  /** Strong beats so far: the renderer steps the palette by it. */
  strong = 0;
  private avg = 0;
  private start = Number.NaN;
  private prev = Number.NaN;

  /** One sample of low-band energy (0..1) at `now`; true on a beat. */
  update(e: number, now: number): boolean {
    if (!Number.isFinite(e)) return false;
    if (Number.isNaN(this.start) || now < this.prev) {
      this.start = this.prev = now;
      this.avg = e;
      return false;
    }
    const dt = Math.min(100, now - this.prev);
    this.prev = now;
    const onset =
      now - this.start >= BEAT.warmupMs &&
      e >= BEAT.floor &&
      e - this.avg >= BEAT.rise &&
      e >= this.avg * BEAT.ratio &&
      now - this.at >= BEAT.refractoryMs;
    if (onset) {
      this.at = now;
      this.strength = beatStrength(e, this.avg);
      if (this.strength >= BEAT.strong) this.strong++;
    }
    this.avg += (e - this.avg) * (1 - Math.exp(-dt / BEAT.tauMs));
    return onset;
  }

  /** Forgets the music (secret mode switched on): the next sample starts the warm-up again. */
  reset(): void {
    this.start = this.prev = Number.NaN;
    this.avg = 0;
    this.at = Number.NEGATIVE_INFINITY;
    this.strength = 0;
  }
}
```

In `src/radio/lightshow.ts`:

```ts
import { BeatTracker } from './beat';
```

```ts
  /** Secret mode's beat (src/radio/beat.ts), fed from the same samples, before and after the win. */
  readonly beat = new BeatTracker();
```

and at the end of `sample`: `this.beat.update(e.low, now);`.

- [ ] **Step 5: Write `src/render/beat-fx.ts`**

```ts
/** What the beat moves in secret mode (spec 2026-10-08 secret mode §5.3). Pure, so a frame allocates nothing. */

const TAU = Math.PI * 2;
const smooth = (x: number) => x * x * (3 - 2 * x);

export const NOD_MS = 260;
/** How far the head dips at the nod's deepest (tiles), and how much it squashes. */
export const NOD_DIP = 0.09;
export const NOD_SQUASH = 0.03;

/** 0 → 1 → 0 over NOD_MS after a beat: a quick dip (30 %) and a slower return. */
export function nodPulse(t: number): number {
  const k = t / NOD_MS;
  if (!(k >= 0 && k < 1)) return 0;
  return k < 0.3 ? smooth(k / 0.3) : 1 - smooth((k - 0.3) / 0.7);
}

/** Extra brightness for every lit tree bulb `t` ms after a beat; gentler under reduced motion. */
export function beatPulse(t: number, strength: number, reduced: boolean): number {
  if (!(t >= 0)) return 0;
  return reduced ? 0.25 * strength * Math.exp(-t / 250) : 0.6 * strength * Math.exp(-t / 180);
}

/** The garland face's bob, in bulb sizes (down): a slow idle sway plus a dip on each beat. Still under reduced motion. */
export function garlandBob(now: number, at: number, strength: number, reduced: boolean): number {
  if (reduced) return 0;
  return 0.05 * Math.sin((TAU * now) / 2400) + 0.16 * strength * nodPulse(now - at);
}
```

- [ ] **Step 6: The head nods**

In `src/render/topper.ts` (import `NOD_DIP`, `NOD_SQUASH`, `nodPulse` from `./beat-fx`):

```ts
  /** Secret mode's beat: when the last one landed and how hard (spec 2026-10-08 secret mode §5.3). */
  private nodAt = Number.NEGATIVE_INFINITY;
  private nodPower = 0;
```

```ts
  /** The beat for this frame (none: -Infinity, 0). The head dips and returns on each one, never under reduced motion. */
  nod(at: number, strength: number): void {
    if (at === this.nodAt && strength === this.nodPower) return;
    this.nodAt = at;
    this.nodPower = strength;
    this.p.now = Number.NaN;
  }
```

In `place()`, replace the `p.cy = …` and `p.k = …` lines with:

```ts
    const nod = reduced ? 0 : this.nodPower * nodPulse(now - this.nodAt);
    p.cy = Y(L, STAR_V) - (flip ? TOSS * L.s * flip.toss : 0) + NOD_DIP * L.s * nod;
    p.k = ignitePop(st, won) * boop * (flip ? 1 + GROW * flip.toss : 1) * (1 - NOD_SQUASH * nod);
```

- [ ] **Step 7: The renderer takes the beat**

In `src/render/renderer.ts` (import `beatPulse`, `garlandBob` from `./beat-fx`):

```ts
/** Secret mode's beat (spec 2026-10-08 secret mode §5): when the last onset landed, how hard (0.3..1), the palette step. */
export interface BeatFrame {
  at: number;
  strength: number;
  hue: number;
}
```

Add to `FrameInput`:

```ts
  /** Secret mode while music drives it: the nod, the bulb pulse, the palette step and the garland face's bob. */
  beat?: BeatFrame;
```

In `draw`, after the face lines from Task 4:

```ts
    const beatAt = f.beat ? f.beat.at : Number.NEGATIVE_INFINITY;
    const beatPower = f.beat ? f.beat.strength : 0;
    const hue = f.beat ? f.beat.hue : 0;
    const nb = sc.bulbs.length;
    this.topper.nod(beatAt, beatPower);
```

Pass 1's halo: `drawBulbHalo(g, sc.bulbs[(board.colors[i] + hue) % nb], this.bulbAmount(f, i) * alpha, s);`.
Pass 2's lit bulb: `else drawBulb(ctx, board.bits[i], sc.bulbs[(board.colors[i] + hue) % nb], amt, s, sc, style);`.
The garland face: replace its last argument `0` with `garlandBob(now, beatAt, beatPower, f.reducedMotion)`.
`bulbAmount`, before `return a;`:

```ts
    if (f.beat) a += beatPulse(f.now - f.beat.at, f.beat.strength, f.reducedMotion);
```

- [ ] **Step 8: Run the tests, typecheck, build**

Run: `npx vitest run tests/unit/radio tests/unit/render && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/radio/beat.ts src/radio/lightshow.ts src/render/beat-fx.ts src/render/topper.ts src/render/renderer.ts tests/unit/radio/beat.test.ts tests/unit/render/beat-fx.test.ts tests/unit/render/topper-draw.test.ts
git commit -m "feat(render): on the beat in secret mode: the head nods, the lights pulse and step hue, the garland face bobs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wiring: the egg's hooks, the app, the probe and the e2e tests

**Files:**
- Modify: `src/ui/star-egg.ts`, `src/app.ts`, `src/debug.ts`
- Create: `tests/e2e/secret-mode.spec.ts`
- Test: `tests/unit/ui/star-egg.test.ts`

**Interfaces:**
- Consumes: `Radio.setSecret`, `Radio.primeSecret`, `Radio.secretWinSound`, `Radio.show.beat` (Tasks 2, 5); `sceneFor` (Task 3); `Renderer.setScene(scene, sweep)`, `Renderer.sweeping`, `Renderer.faceInfo()`, `BeatFrame` (Tasks 3–5); `WinSound` (Task 2); `FLIP_MS` (`src/render/topper.ts`).
- Produces:
  - `src/ui/star-egg.ts`: `EggHooks.mode?(on: boolean, how: 'start' | 'loud' | 'quiet'): void`, `EggHooks.gesture?(on: boolean): void`.
  - `src/app.ts`: `App.secretState: { on: boolean; scene: string; sweeping: boolean; faceTile: number; faceGift: number; faceGarland: number }`.
  - `src/debug.ts`: `AglowProbe.secret()`; `AglowProbe.radio()` gains `source: string | null` and `secretListed: boolean`.

- [ ] **Step 1: Write the failing egg tests**

Append inside `describe('StarEgg', …)` in `tests/unit/ui/star-egg.test.ts`:

```ts
  describe('secret mode hooks', () => {
    const key = (k: string) => ({ key: k, target: document.body, ctrlKey: false, metaKey: false, altKey: false, repeat: false });

    it("reports the starting value, then the player's toggles as loud", async () => {
      const { h } = hooks();
      const mode = vi.fn();
      h.mode = mode;
      const egg = new StarEgg(new Session(), h, false);
      expect(mode).toHaveBeenCalledWith(false, 'start');
      fiveTaps(egg);
      await flush();
      expect(mode).toHaveBeenLastCalledWith(true, 'loud');
      fiveTaps(egg);
      expect(mode).toHaveBeenLastCalledWith(false, 'loud');
    });

    it('calls gesture synchronously inside the fifth tap and the last letter, with where it is heading', () => {
      const { h } = hooks();
      const gesture = vi.fn();
      h.gesture = gesture;
      const egg = new StarEgg(new Session(), h, false);
      for (let k = 0; k < 4; k++) egg.tap((now += 200));
      expect(gesture).not.toHaveBeenCalled();
      egg.tap((now += 200));
      expect(gesture).toHaveBeenCalledWith(true); // before the sticker's load has resolved
      const typedHooks = hooks().h;
      const g2 = vi.fn();
      typedHooks.gesture = g2;
      const typed = new StarEgg(new Session(), typedHooks, true);
      for (const c of 'hohoho') typed.key(key(c), (now += 100));
      expect(g2).toHaveBeenCalledWith(false);
    });

    it('a sign-in that changes it is quiet', async () => {
      const { h } = hooks();
      const mode = vi.fn();
      h.mode = mode;
      const session = new Session();
      new StarEgg(session, h, false);
      session.set(user(true));
      await flush();
      expect(mode).toHaveBeenLastCalledWith(true, 'quiet');
    });

    it('a stored head whose sticker fails turns secret mode off quietly', async () => {
      loads = false;
      const { h } = hooks();
      const mode = vi.fn();
      h.mode = mode;
      new StarEgg(new Session(), h, true);
      expect(mode).toHaveBeenCalledWith(true, 'start');
      await flush();
      expect(mode).toHaveBeenLastCalledWith(false, 'quiet');
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/ui/star-egg.test.ts`
Expected: FAIL (`mode` never called).

- [ ] **Step 3: The egg's hooks**

In `src/ui/star-egg.ts`, add to `EggHooks`:

```ts
  /**
   * Secret mode follows the head (spec 2026-10-08 secret mode §1): 'start' when constructed, 'loud' for the player's
   * own toggle, 'quiet' for a sign-in or a stored head whose sticker failed.
   */
  mode?(on: boolean, how: 'start' | 'loud' | 'quiet'): void;
  /** Called synchronously inside the gesture that completes a toggle (the 5th tap, the last letter), before anything async: `on` is where it is heading. */
  gesture?(on: boolean): void;
```

Constructor:

```ts
    this.on = starHeadFor(local, session.current);
    h.topper.set(this.on);
    h.mode?.(this.on, 'start');
    if (this.on) {
      // A stored head whose sticker can't load: the star, quietly, for this visit (the preference itself stays).
      void h.topper.load().then((ok) => {
        if (ok || !this.on || this.turning) return;
        this.on = false;
        h.topper.set(false);
        h.mode?.(false, 'quiet');
      });
    }
```

`tap`, before `this.toggle(now);`: `if (!this.turning) this.h.gesture?.(!this.on);`
`key`, after the `feed` check: `if (!this.turning) this.h.gesture?.(!this.on);` then `this.toggle(now);`.
`apply`, right after `this.h.flipped?.();`: `this.h.mode?.(on, loud ? 'loud' : 'quiet');`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run tests/unit/ui/star-egg.test.ts`
Expected: PASS (new and existing).

- [ ] **Step 5: Wire secret mode into the app**

In `src/app.ts`:

1. Imports:

```ts
import { audio } from './audio/context';
import { WinSound } from './radio/win-sound';
import type { BeatFrame } from './render/renderer';
import { sceneFor, sceneForHour, type Scene, type SceneId } from './render/scenes';
```

(This replaces the old `SCENES, sceneForHour, type SceneId` import; `setScene` was its only use of `SCENES`.)

2. Ink:

```ts
const INK: Record<Scene['id'], string> = { midnight: '#f3ead8', fireside: '#f4e6cf', frost: '#15261f', aurora: '#eef0ff' };
```

and in `prepareShare`: `INK[this.renderer.scene.id]`.

3. Fields:

```ts
  /** Secret mode (spec 2026-10-08 secret mode): on exactly while the head tops the tree. */
  private secret = false;
  /** The Secret station's win ad-lib. */
  private readonly winSound = new WinSound();
  /** The beat handed to the renderer, reused every frame. */
  private readonly beat: BeatFrame = { at: Number.NEGATIVE_INFINITY, strength: 0, hue: 0 };
```

4. The egg's hooks gain:

```ts
        // Inside the completing gesture: the Secret station may only start later, so the radio is primed now.
        gesture: (on) => {
          if (on) this.radio.primeSecret();
        },
        mode: (on, how) => this.setSecret(on, how),
```

5. The switch:

```ts
  /**
   * Secret mode follows the head (spec 2026-10-08 secret mode §1). 'start': the first applySettings puts the scene up.
   * 'loud' (the player's toggle): the sky sweeps from the flip's midpoint and the Secret station plays. 'quiet' (a
   * sign-in, a sticker that failed): at once, and nothing starts. The egg's `flipped` re-renders the share image.
   */
  private setSecret(on: boolean, how: 'start' | 'loud' | 'quiet'): void {
    const changed = on !== this.secret;
    this.secret = on;
    this.radio.setSecret(on, how === 'loud');
    if (on && changed) {
      this.radio.show.beat.reset();
      this.winSound.preload(this.radio.secretWinSound(), audio.ctx);
    }
    if (how === 'start' || !changed) return;
    const reduced = this.reduced.matches;
    const sweep = how === 'loud' ? { now: performance.now() + (reduced ? 0 : FLIP_MS / 2), reduced } : null;
    this.pausedDrawn = false;
    this.setScene(this.sceneId, sweep);
  }
```

6. `setScene`:

```ts
  /** Returns whether the scene changed. In secret mode the stage shows the aurora whatever the hour; `id` still drives the radio's suggestion. */
  private setScene(id: SceneId, sweep: { now: number; reduced: boolean } | null = null): boolean {
    this.radio.setScene(id);
    const scene = sceneFor(id, this.secret);
    if (id === this.sceneId && this.renderer.scene === scene) return false;
    this.sceneId = id;
    document.body.dataset.scene = scene.id;
    this.renderer.setScene(scene, sweep);
    return true;
  }
```

7. The frame loop, replacing the light-show lines:

```ts
    // The post-win light show (spec §5.4): beats pulse the bulbs up the tree, the low band breathes the glow.
    const show = this.winAt !== null && this.radio.lightShowActive && !this.reduced.matches;
    this.lightShowOn = show;
    // Secret mode's beat (spec 2026-10-08 secret mode §5.2): the same analyser, before and after the win.
    const beating = this.secret && this.radio.lightShowActive;
    if (show || beating) this.radio.show.sample(now);
    this.renderer.frame({
      board: this.board, vis: this.vis, now, dt, camera: this.camera, hover: this.hover,
      revealAt: this.run.revealAt, winAt: this.winAt, reducedMotion: this.reduced.matches,
      extraBulb: show ? (i) => this.radio.show.extraBulb(Math.floor(i / GRID.w), now) : undefined,
      ambient: show ? this.radio.show.low : 0,
      beat: beating ? this.beatFrame() : undefined,
    });
```

```ts
  private beatFrame(): BeatFrame {
    const b = this.radio.show.beat;
    this.beat.at = b.at;
    this.beat.strength = b.strength;
    this.beat.hue = this.reduced.matches ? 0 : b.strong;
    return this.beat;
  }
```

8. The win, in `presentWin`:

```ts
    if (sound) {
      setTimeout(() => {
        if (this.board !== game) return;
        this.sfx.win();
        if (this.secret) this.playWinSound();
      }, delay);
    }
```

```ts
  /** Secret mode's win ad-lib (spec §4.6): a game sound, so only with the effects volume up; the music ducks under it. */
  private playWinSound(): void {
    const url = this.radio.secretWinSound();
    const ctx = audio.ctx;
    if (!url || !ctx || !audio.sfx || this.settings.effectsVolume <= 0) return;
    void this.winSound.play(url, ctx, audio.sfx).then((played) => {
      if (played) this.radio.duck();
    });
  }
```

9. The test hook's view, next to `starHead`:

```ts
  /** Secret mode: on, the stage's scene, a sky sweep under way, and where Luke's face is (-1: not placed). */
  get secretState(): { on: boolean; scene: string; sweeping: boolean; faceTile: number; faceGift: number; faceGarland: number } {
    const f = this.renderer.faceInfo();
    return { on: this.secret, scene: this.renderer.scene.id, sweeping: this.renderer.sweeping, faceTile: f.tile, faceGift: f.gift, faceGarland: f.garland };
  }
```

In `src/debug.ts`, extend `AglowProbe`:

```ts
  /** `lightShow`: the post-win light show drew the last frame. `source`: the station id for a station, else the kind. `secretListed`: the panel shows the Secret row. */
  radio(): { kind: string | null; playing: boolean; stations: string[]; catalogLoaded: boolean; lightShow: boolean; source: string | null; secretListed: boolean };
  /** Secret mode: on, the stage's scene, a sky sweep under way, and where Luke's face is (-1: not placed). */
  secret(): { on: boolean; scene: string; sweeping: boolean; faceTile: number; faceGift: number; faceGarland: number };
```

and in the probe:

```ts
    radio: () => {
      const v = app.radio.view();
      return {
        kind: v.kind, playing: v.playing, stations: v.stations.map((s) => s.id), catalogLoaded: app.radio.catalogLoaded,
        lightShow: app.lightShowOn, source: v.kind === 'station' ? (v.station?.id ?? null) : v.kind, secretListed: v.secretMode,
      };
    },
    secret: () => app.secretState,
```

- [ ] **Step 6: Typecheck, the unit suite, the build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Write the e2e tests**

Create `tests/e2e/secret-mode.spec.ts`:

```ts
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ready, type W } from './helpers';

test.describe.configure({ timeout: 120_000 });

const secret = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.secret());
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());

/** Seconds of 8 kHz mono silence as a WAV: a track Playwright's Chromium can play (it has no AAC). */
function silentWav(seconds = 2, rate = 8000): Buffer {
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

const SECRET = {
  id: 'secret', name: 'Secret', description: '',
  tracks: [{ id: 's1', url: '/e2e-media/secret.wav', title: '12 Days of Christmas', artist: 'Gucci Mane', credit: '', duration: 2 }],
};

/** The station list (null: no endpoint, a 404) and its media, routed: no storage is touched. */
async function stations(page: Page, list: unknown[] | null): Promise<void> {
  await page.route('**/api/stations', (r) => (list === null ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ json: { version: 1, stations: list } })));
  await page.route('**/e2e-media/**', (r) => r.fulfill({ body: silentWav(), contentType: 'audio/wav' }));
}

/** Radio settings for the first load (a reload keeps what the page saved). */
const pinRadio = (page: Page, over: Record<string, unknown>) =>
  page.addInitScript((o) => {
    if (localStorage.getItem('aglow.radio') === null) {
      localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: true, source: null, embedUrl: null, volume: 0.7, lightShow: true, ...o }));
    }
  }, over);

async function tapStar(page: Page, times: number): Promise<void> {
  const [x, y] = (await page.evaluate(() => (window as unknown as W).__aglow.star())).center;
  for (let k = 0; k < times; k++) await page.mouse.click(x, y);
}

async function tapTile(page: Page): Promise<void> {
  const [x, y] = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.tileCenter(a.ids[40]);
  });
  await page.mouse.click(x, y);
}

test('by hand: the aurora sweeps in, the Secret station is listed and plays, the faces are placed; off restores the Fireplace', async ({ page }) => {
  await stations(page, [SECRET]);
  await pinRadio(page, { source: 'fireplace' });
  await ready(page);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  const before = await secret(page);
  expect(before).toMatchObject({ on: false, faceTile: -1, faceGift: -1, faceGarland: -1 });
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .st[data-id="secret"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await tapStar(page, 5);
  await expect.poll(async () => (await secret(page)).scene).toBe('aurora');
  await expect(page.locator('body')).toHaveAttribute('data-scene', 'aurora');
  await expect.poll(async () => (await radio(page)).source).toBe('secret');
  expect((await radio(page)).secretListed).toBe(true);
  await expect.poll(async () => (await secret(page)).sweeping).toBe(false);
  const on = await secret(page);
  expect(on.faceTile).toBeGreaterThanOrEqual(0);
  expect(on.faceGift).toBeGreaterThanOrEqual(0);
  expect(on.faceGarland).toBeGreaterThanOrEqual(0);

  await page.click('#radio-pill');
  const row = page.locator('#radio-panel .st[data-id="secret"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Secret');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');

  await tapStar(page, 5);
  await expect.poll(async () => (await secret(page)).scene).toBe(before.scene);
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  expect(await secret(page)).toMatchObject({ on: false, faceTile: -1, faceGift: -1, faceGarland: -1 });
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .st[data-id="secret"]')).toHaveCount(0);
});

test('with no Secret station, switching on plays the celesta, and switching off brings back the silence it found', async ({ page }) => {
  await stations(page, null);
  await ready(page);
  expect((await radio(page)).playing).toBe(false);
  await tapStar(page, 5);
  await expect.poll(async () => (await radio(page)).kind).toBe('celesta');
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel .st[data-id="secret"]')).toContainText('Dreamy celesta carols');
  await expect(page.locator('#radio-panel .station')).toHaveText('Secret');
  await page.keyboard.press('Escape');
  await tapStar(page, 5);
  await expect.poll(async () => (await radio(page)).kind).toBeNull();
  expect((await radio(page)).playing).toBe(false);
});

test('a load in secret mode shows the aurora at once, with no sweep and no music; the first move starts the secret suggestion', async ({ page }) => {
  await stations(page, null);
  await page.addInitScript(() => localStorage.setItem('aglow.starHead', 'true'));
  await ready(page);
  expect(await secret(page)).toMatchObject({ on: true, scene: 'aurora', sweeping: false });
  expect((await radio(page)).playing).toBe(false);
  await tapTile(page);
  await expect.poll(async () => (await radio(page)).kind).toBe('celesta');
});

test('a muted radio: the world changes, the music does not', async ({ page }) => {
  await stations(page, [SECRET]);
  await pinRadio(page, { volume: 0 });
  await ready(page);
  await tapStar(page, 5);
  await expect.poll(async () => (await secret(page)).scene).toBe('aurora');
  await page.waitForTimeout(500);
  expect(await radio(page)).toMatchObject({ kind: null, playing: false });
});
```

- [ ] **Step 8: Run the e2e tests**

Run: `npx playwright test tests/e2e/secret-mode.spec.ts tests/e2e/star-head.spec.ts tests/e2e/radio.spec.ts --project=desktop`
Expected: PASS (the new file, and the egg and radio files unchanged in behaviour).

- [ ] **Step 9: Commit**

```bash
git add src/ui/star-egg.ts src/app.ts src/debug.ts tests/unit/ui/star-egg.test.ts tests/e2e/secret-mode.spec.ts
git commit -m "feat(app): secret mode follows the head: the sweep, the Secret station, the beat and the win ad-lib

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A live local build for Luke's visual review

Luke judges by playing. This task changes no code: it verifies everything, then leaves a live local build running for him.

**Files:** none (no commit).

- [ ] **Step 1: Run everything**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.
Run: `npm run e2e`
Expected: PASS on desktop and phone (about 10 minutes). Playwright stops its own server on `:4173` when it finishes.

- [ ] **Step 2: Start the review server**

Make sure nothing is on the port (`lsof -ti tcp:4173` prints nothing; if it prints a pid from an earlier run, stop that process). Then, in the background (Bash `run_in_background: true`):

```bash
npm run build && npm run serve:e2e
```

This is local only: a fresh local D1 in `.wrangler/e2e`, local R2, `wrangler dev` on `:4173` with `AUTH_MODE=fake` and `ADMIN_EMAILS=admin@example.com`. Never add `--remote`.

- [ ] **Step 3: Wait for it, then smoke-test it**

Wait until `curl -sf -o /dev/null http://localhost:4173/` succeeds (poll every 2 s, up to 3 minutes; use Monitor with an until-loop, not a foreground sleep). Then:

```bash
curl -s http://localhost:4173/api/stations
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/star-head.png
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/admin
```

Expected: `{"version":0,"stations":[]}`, `200`, `200`.

- [ ] **Step 4: Hand it to Luke**

Leave the server running and report to the controller, for Luke, exactly this:

- **Play:** <http://localhost:4173/>. Secret mode: tap the star 5 times quickly, or type `hohoho`; the same again turns it off.
- **Signed in (fake Google, local only):** <http://localhost:4173/api/auth/google?as=luke@example.com&return=/> signs in as a test account, so the mode follows the account across a reload or another browser.
- **The admin side:** <http://localhost:4173/api/auth/google?as=admin@example.com&return=/admin> opens `/admin` as the local admin: "+ Secret station", the "Secret mode only" badge and the win ad-lib row. Uploads there land in the local R2 but are served from the production media host, so they won't play in this local build (spec ruling 19); the local Secret station is empty and switching on plays the celesta, whose low notes drive the beat. The Gucci Mane MP3 goes up through production `/admin` after deploy.
- **What to judge:** the sweep on and off (and the reverse); the aurora sky and its curtains at rest; the tree, wire styles (Settings: filament, fairy, neon) and presents in the aurora palette; the face ornament (dim, then lit), the face present, the garland face and its bob; the head nodding and the bulbs pulsing and stepping hue with the music (radio light-show button on); the face-confetti win; phone size (DevTools device mode) and Reduced Motion (System Settings, Accessibility, Display) as well.
- To stop it: stop the background task (or `lsof -ti tcp:4173 | xargs kill`).

Do not deploy, do not touch `Music MP3s/`, do not commit anything in this task.

---

## Rollout (controller and Luke only: not a subagent task)

After Luke approves the visual review: he deploys (`npm run deploy`; it runs the checks, the migrations and `wrangler deploy` himself), checks the secrets afterwards as usual, then in production `/admin` creates the Secret station, uploads "12 Days of Christmas" and, optionally, a win ad-lib, and saves.
