# Aglow — Plan 2: Radio and Light Show — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Aglow Radio: stations with crossfading playback, a synthesized Fireplace, Spotify/Apple Music embeds, the radio pill/panel/sheet, music ducking, and the post-win light show synced to the music.

**Architecture:** Everything lives in `src/radio/` behind a `Radio` facade. Playback runs two `HTMLAudioElement` decks routed through Web Audio into `audio.music` (from Plan 1), which lets us crossfade, duck and analyse. Stations come from `/api/stations` in production (Plan 3 serves it) or `/dev-stations.json` in development (served from the git-ignored `Music MP3s/` folder by a dev-only Vite plugin). Bundled Piano Carols live in `public/audio/piano/`. `src/ui/radio-panel.ts` renders into `#radio-slot`.

**Tech Stack:** TypeScript, Web Audio (MediaElementSource, AnalyserNode), Media Session API, Vite plugin API, Vitest, Playwright, ffmpeg (for transcoding the bundled carols).

**Spec:** `docs/superpowers/specs/2026-09-29-aglow-design.md` (§5.2–5.4, §8). Visual reference: `docs/prototype/radio-mockup.html`. **Do not build the "My Music" / MP3 drop section shown in the mockup; it was cut.**

**Prerequisite:** Plan 1 is complete (`docs/superpowers/plans/2026-09-29-aglow-1-game.md`).

## Global Constraints

- Plan 1 constraints still apply (strict TS, no `any`, storage only via `src/store/storage.ts`, commit trailer).
- Stations (launch): **Christmas Jazz** (`christmas-jazz`) and **Christmas Classics** (`christmas-classics`), both uploaded by Luke via Plan 3; **Piano Carols** (`piano-carols`), bundled PD/CC0/CC-BY recordings; **Fireplace** (`fireplace`), synthesized. No local file upload.
- Spotify/Apple: official embeds only. Presets are Luke's playlists: Jazz `https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4`, Classics `https://open.spotify.com/playlist/0N1jXhN0GD3mUEs6prVPVQ`. Spotify is never an audio *source* for our own stations.
- Music starts (fading in) on the player's **first tile tap**. Muting via the pill is remembered.
- Crossfade 3s; shuffle on by default; skip on error; 3 consecutive failures → the station is marked unavailable for the session.
- Game sounds duck music by ~4dB (×0.63) for ~250ms.
- Light show: default on after winning, only for analysable sources (stations and Fireplace), disabled under reduced motion.
- `Music MP3s/` is local test audio only: it is served by the dev server and never committed or deployed.
- Every track shows its credit line.

---

## File Map

```
public/audio/piano/*.m4a           bundled Piano Carols (Task 1)
public/audio/piano/credits.json    StationsFile describing them (Task 1)
src/radio/schema.ts                Track/Station/StationsFile + validators (shared with Plan 3's API)
src/radio/builtin.ts               built-in ids, Piano Carols metadata, scene → station suggestion
src/radio/catalog.ts               load + merge remote and bundled stations
src/radio/queue.ts                 shuffle / next / prev
src/radio/embed.ts                 Spotify/Apple link parsing + presets
src/radio/player.ts                RadioPlayer: two decks, crossfade, errors, Media Session
src/radio/fireplace.ts             procedural crackle + wind
src/radio/lightshow.ts             band energies, beat detection, per-bulb pulse
src/radio/radio.ts                 Radio facade (source selection, volume, ducking, persistence)
src/store/radio-settings.ts        persisted radio settings
src/ui/radio-panel.ts              pill + popover (desktop) / bottom sheet (phone)
src/ui/radio.css
vite.config.ts                     + dev-music plugin
tests/unit/radio/*.test.ts
tests/e2e/radio.spec.ts
```

---

### Task 1: Station schema and the bundled Piano Carols

**Files:**
- Create: `src/radio/schema.ts`, `src/radio/builtin.ts`, `public/audio/piano/*.m4a`, `public/audio/piano/credits.json`
- Test: `tests/unit/radio/schema.test.ts`, `tests/unit/radio/piano-bundle.test.ts`

**Interfaces:**
- Produces:
  - `interface Track { id; url; title; artist; credit; duration; cover? }`, `interface Station { id; name; description; cover?; tracks: Track[] }`, `interface StationsFile { version; stations }`.
  - `parseTrack`, `parseStation`, `parseStationsFile(v: unknown): StationsFile | null`.
  - `FIREPLACE_ID`, `PIANO_ID`, `PIANO_META`, `SCENE_STATION: Record<SceneId, string>`.

- [ ] **Step 1: Write the failing schema tests**

`tests/unit/radio/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseStationsFile } from '../../../src/radio/schema';

const track = { id: 't1', url: 'https://x.public.blob.vercel-storage.com/a.mp3', title: 'Sleigh Ride', artist: 'Someone', credit: 'Uploaded by Luke', duration: 185 };
const file = { version: 3, stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: 'Curated by Luke', tracks: [track] }] };

describe('parseStationsFile', () => {
  it('accepts a valid file', () => {
    expect(parseStationsFile(file)).toEqual(file);
  });
  it('accepts site-relative URLs (bundled audio)', () => {
    const f = { ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: '/audio/piano/a.m4a' }] }] };
    expect(parseStationsFile(f)).not.toBeNull();
  });
  it('rejects bad ids, empty titles, http URLs and duplicate ids', () => {
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], id: 'Bad Id' }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, title: ' ' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: 'http://evil/a.mp3' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [file.stations[0], file.stations[0]] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [track, track] }] })).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(parseStationsFile(null)).toBeNull();
    expect(parseStationsFile({ version: -1, stations: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/radio/schema.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/radio/schema.ts`**

```ts
export interface Track {
  id: string;
  url: string;
  title: string;
  artist: string;
  credit: string;
  /** Seconds; 0 if unknown. */
  duration: number;
  cover?: string;
}

export interface Station {
  id: string;
  name: string;
  description: string;
  cover?: string;
  tracks: Track[];
}

export interface StationsFile {
  version: number;
  stations: Station[];
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** https URLs or site-relative paths only. */
const isUrl = (v: unknown): v is string => isStr(v, 2000) && (v.startsWith('https://') || (v.startsWith('/') && !v.startsWith('//')));
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseTrack(v: unknown): Track | null {
  const o = obj(v);
  if (!o) return null;
  const { id, url, title, artist, credit, duration, cover } = o;
  if (!isStr(id, 64) || id === '' || !isUrl(url) || !isStr(title, 200) || title.trim() === '') return null;
  if (!isStr(artist, 200) || !isStr(credit, 500) || typeof duration !== 'number' || !(duration >= 0)) return null;
  if (cover !== undefined && !isUrl(cover)) return null;
  return { id, url, title, artist, credit, duration, ...(cover !== undefined ? { cover } : {}) };
}

export function parseStation(v: unknown): Station | null {
  const o = obj(v);
  if (!o) return null;
  const { id, name, description, cover, tracks } = o;
  if (!isStr(id, 64) || !ID.test(id) || !isStr(name, 60) || name.trim() === '' || !isStr(description, 200)) return null;
  if (cover !== undefined && !isUrl(cover)) return null;
  if (!Array.isArray(tracks) || tracks.length > 500) return null;
  const parsed: Track[] = [];
  const ids = new Set<string>();
  for (const t of tracks) {
    const p = parseTrack(t);
    if (!p || ids.has(p.id)) return null;
    ids.add(p.id);
    parsed.push(p);
  }
  return { id, name, description, ...(cover !== undefined ? { cover } : {}), tracks: parsed };
}

export function parseStationsFile(v: unknown): StationsFile | null {
  const o = obj(v);
  if (!o || !Number.isInteger(o.version) || (o.version as number) < 0 || !Array.isArray(o.stations) || o.stations.length > 20) return null;
  const stations: Station[] = [];
  const ids = new Set<string>();
  for (const s of o.stations) {
    const p = parseStation(s);
    if (!p || ids.has(p.id)) return null;
    ids.add(p.id);
    stations.push(p);
  }
  return { version: o.version as number, stations };
}
```

- [ ] **Step 4: Implement `src/radio/builtin.ts`**

```ts
import type { SceneId } from '../render/scenes';

export const FIREPLACE_ID = 'fireplace';
export const PIANO_ID = 'piano-carols';
export const PIANO_META = { id: PIANO_ID, name: 'Piano Carols', description: 'Public-domain carols, solo piano' } as const;

/** Each scene suggests a station without forcing it (spec §5.2). */
export const SCENE_STATION: Readonly<Record<SceneId, string>> = {
  fireside: 'christmas-jazz',
  midnight: PIANO_ID,
  frost: 'christmas-classics',
};
```

- [ ] **Step 5: Run the schema tests**

Run: `npx vitest run tests/unit/radio/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Source 5–8 licence-clean piano carol recordings**

Rules:
- Only recordings whose **file page** states **Public domain, CC0, or CC BY** (any version). Reject CC BY-SA, CC BY-NC and anything unclear.
- Solo piano only.
- Prefer distinct carols: Silent Night, O Holy Night, Hark! The Herald Angels Sing, Joy to the World, The First Noel, O Come All Ye Faithful, Deck the Halls, God Rest Ye Merry Gentlemen, Away in a Manger, We Wish You a Merry Christmas.

Where to look:
- Wikimedia Commons: search `https://commons.wikimedia.org/w/index.php?search=<carol>+piano&title=Special:MediaSearch&type=audio` and open each file page to read its licence box.
- Musopen (musopen.org): public-domain recordings, only if downloadable without paid terms.

For each accepted recording:
1. Download it into a temp folder outside the repo.
2. Transcode with loudness normalisation:
   ```bash
   ffmpeg -i "<input>" -vn -ac 2 -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 128k -movflags +faststart "public/audio/piano/<slug>.m4a"
   ```
3. Read its duration:
   ```bash
   ffprobe -v error -show_entries format=duration -of csv=p=0 "public/audio/piano/<slug>.m4a"
   ```

If fewer than 3 qualify, **stop and tell Luke** rather than lowering the licence bar.

- [ ] **Step 7: Write `public/audio/piano/credits.json`** in the `StationsFile` format, one track per file

Example (the real entries must come from Step 6):
```json
{
  "version": 0,
  "stations": [
    {
      "id": "piano-carols",
      "name": "Piano Carols",
      "description": "Public-domain carols, solo piano",
      "tracks": [
        {
          "id": "silent-night",
          "url": "/audio/piano/silent-night.m4a",
          "title": "Silent Night",
          "artist": "<performer as credited on the file page>",
          "credit": "\"Silent Night\" performed by <performer>. <licence, e.g. CC BY 4.0>. Source: <file page URL>",
          "duration": 162
        }
      ]
    }
  ]
}
```

- [ ] **Step 8: Test the bundle**

`tests/unit/radio/piano-bundle.test.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PIANO_ID } from '../../../src/radio/builtin';
import { parseStationsFile } from '../../../src/radio/schema';

it('ships at least three credited piano carols whose files exist', () => {
  const file = parseStationsFile(JSON.parse(readFileSync('public/audio/piano/credits.json', 'utf8')));
  const station = file?.stations.find((s) => s.id === PIANO_ID);
  expect(station).toBeDefined();
  expect(station!.tracks.length).toBeGreaterThanOrEqual(3);
  for (const t of station!.tracks) {
    expect(t.credit).toMatch(/(public domain|CC0|CC BY)/i);
    expect(t.duration).toBeGreaterThan(0);
    expect(existsSync(`public${t.url}`)).toBe(true);
  }
});
```

This test uses Node APIs. Install Node types and add them to `tsconfig.json`:

```bash
npm install -D @types/node
```

In `tsconfig.json`, change `"types": ["vite/client"]` to `"types": ["vite/client", "node"]`.

Run: `npx vitest run tests/unit/radio && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/radio public/audio tests/unit/radio tsconfig.json package.json package-lock.json
git commit -m "feat(radio): station schema and bundled public-domain piano carols

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Queue, embeds and radio settings (pure logic)

**Files:**
- Create: `src/radio/queue.ts`, `src/radio/embed.ts`, `src/store/radio-settings.ts`
- Test: `tests/unit/radio/queue.test.ts`, `tests/unit/radio/embed.test.ts`, `tests/unit/radio/radio-settings.test.ts`

**Interfaces:**
- Produces:
  - `shuffled(items, rng)`, `buildQueue(items, shuffle, rng)`, `nextIndex(i, n)`, `prevIndex(i, n, positionSec)`.
  - `interface Embed { provider: 'spotify'|'apple'; src: string; height: number; label: string }`, `parseEmbed(url): Embed|null`, `EMBED_PRESETS: readonly {name, url}[]`.
  - `interface RadioSettings { v: 1; on: boolean; source: string|null; embedUrl: string|null; volume: number; shuffle: boolean; lightShow: boolean }`, `DEFAULT_RADIO`, `loadRadioSettings()`, `saveRadioSettings(s)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/radio/queue.test.ts`:
```ts
import { expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { buildQueue, nextIndex, prevIndex } from '../../../src/radio/queue';

it('shuffles without losing or duplicating tracks', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const q = buildQueue(items, true, mulberry32(1));
  expect([...q].sort((a, b) => a - b)).toEqual(items);
  expect(q).not.toEqual(items);
  expect(buildQueue(items, false, mulberry32(1))).toEqual(items);
});
it('wraps next, and restarts on prev after 3 seconds', () => {
  expect(nextIndex(4, 5)).toBe(0);
  expect(prevIndex(0, 5, 1)).toBe(4);
  expect(prevIndex(2, 5, 10)).toBe(2);
});
```

`tests/unit/radio/embed.test.ts`:
```ts
import { expect, it } from 'vitest';
import { EMBED_PRESETS, parseEmbed } from '../../../src/radio/embed';

it("parses Luke's Spotify playlists (with share params)", () => {
  const e = parseEmbed('https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4?si=jOmM1zzYRIOxCA9VhUmgAQ');
  expect(e).toEqual({ provider: 'spotify', src: 'https://open.spotify.com/embed/playlist/3rKFTakI4TxtuNLJ1Ruog4?utm_source=generator&theme=0', height: 152, label: 'Spotify playlist' });
  expect(parseEmbed('https://open.spotify.com/intl-de/playlist/0N1jXhN0GD3mUEs6prVPVQ')?.provider).toBe('spotify');
});
it('parses Apple Music playlists', () => {
  const e = parseEmbed('https://music.apple.com/us/playlist/christmas-jazz/pl.u-abc123XYZ');
  expect(e?.src).toBe('https://embed.music.apple.com/us/playlist/christmas-jazz/pl.u-abc123XYZ');
});
it('rejects anything that is not a playlist link', () => {
  for (const bad of ['', 'hello', 'https://open.spotify.com/track/123', 'https://evil.com/playlist/abc', 'javascript:alert(1)']) expect(parseEmbed(bad)).toBeNull();
});
it("offers Luke's two playlists as presets", () => {
  expect(EMBED_PRESETS.map((p) => parseEmbed(p.url)?.provider)).toEqual(['spotify', 'spotify']);
});
```

`tests/unit/radio/radio-settings.test.ts`:
```ts
// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_RADIO, loadRadioSettings, saveRadioSettings } from '../../../src/store/radio-settings';

beforeEach(() => localStorage.clear());

it('defaults to music on, shuffle on, light show on', () => {
  expect(loadRadioSettings()).toEqual(DEFAULT_RADIO);
  expect(DEFAULT_RADIO).toMatchObject({ on: true, shuffle: true, lightShow: true, source: null });
});
it('persists and validates', () => {
  saveRadioSettings({ ...DEFAULT_RADIO, on: false, source: 'fireplace', volume: 0.4 });
  expect(loadRadioSettings()).toMatchObject({ on: false, source: 'fireplace', volume: 0.4 });
  localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, volume: 7 }));
  expect(loadRadioSettings()).toEqual(DEFAULT_RADIO);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/radio`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/radio/queue.ts`**

```ts
import type { Rng } from '../core/rng';

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const buildQueue = <T>(items: readonly T[], shuffle: boolean, rng: Rng): T[] => (shuffle ? shuffled(items, rng) : [...items]);
export const nextIndex = (i: number, n: number): number => (i + 1) % n;
/** Previous restarts the current track if it has played for more than 3 seconds. */
export const prevIndex = (i: number, n: number, positionSec: number): number => (positionSec > 3 ? i : (i - 1 + n) % n);
```

- [ ] **Step 4: Implement `src/radio/embed.ts`**

```ts
export interface Embed {
  provider: 'spotify' | 'apple';
  src: string;
  height: number;
  label: string;
}

/** Official embeds only (spec §5.2). Returns null for anything that isn't a playlist link. */
export function parseEmbed(input: string): Embed | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{10,40})\/?$/);
    return m ? { provider: 'spotify', src: `https://open.spotify.com/embed/playlist/${m[1]}?utm_source=generator&theme=0`, height: 152, label: 'Spotify playlist' } : null;
  }
  if (u.hostname === 'music.apple.com' || u.hostname === 'embed.music.apple.com') {
    const m = u.pathname.match(/^\/([a-z]{2})\/playlist\/([^/]+)\/(pl\.[A-Za-z0-9.-]+)\/?$/);
    return m ? { provider: 'apple', src: `https://embed.music.apple.com/${m[1]}/playlist/${m[2]}/${m[3]}`, height: 175, label: 'Apple Music playlist' } : null;
  }
  return null;
}

export const EMBED_PRESETS: readonly { name: string; url: string }[] = [
  { name: 'Christmas Jazz on Spotify', url: 'https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4' },
  { name: 'Christmas Classics on Spotify', url: 'https://open.spotify.com/playlist/0N1jXhN0GD3mUEs6prVPVQ' },
];
```

- [ ] **Step 5: Implement `src/store/radio-settings.ts`**

```ts
import { readJSON, writeJSON } from './storage';

export interface RadioSettings {
  v: 1;
  on: boolean;
  /** Station id, 'fireplace', 'embed', or null = follow the scene's suggestion. */
  source: string | null;
  embedUrl: string | null;
  volume: number;
  shuffle: boolean;
  lightShow: boolean;
}

export const DEFAULT_RADIO: RadioSettings = { v: 1, on: true, source: null, embedUrl: null, volume: 0.7, shuffle: true, lightShow: true };

const KEY = 'aglow.radio';

function isRadioSettings(v: unknown): v is RadioSettings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const strOrNull = (x: unknown) => x === null || (typeof x === 'string' && x.length <= 2000);
  return (
    o.v === 1 && typeof o.on === 'boolean' && strOrNull(o.source) && strOrNull(o.embedUrl) &&
    typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1 && typeof o.shuffle === 'boolean' && typeof o.lightShow === 'boolean'
  );
}

export const loadRadioSettings = (): RadioSettings => readJSON(KEY, isRadioSettings) ?? { ...DEFAULT_RADIO };
export const saveRadioSettings = (s: RadioSettings): void => writeJSON(KEY, s);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/radio`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/radio src/store tests/unit/radio
git commit -m "feat(radio): queue, playlist embed parsing and persisted radio settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Catalog loading and the dev-only music server

**Files:**
- Create: `src/radio/catalog.ts`
- Modify: `vite.config.ts` (add the dev-music plugin)
- Test: `tests/unit/radio/catalog.test.ts`

**Interfaces:**
- Consumes: `parseStationsFile`, `PIANO_ID`, `PIANO_META`.
- Produces: `STATIONS_URL`, `mergeCatalog(remote, bundledPiano): Station[]`, `loadCatalog(fetchFn?): Promise<{ stations: Station[]; remoteOk: boolean }>`. Dev endpoints `/dev-stations.json` and `/dev-music/<file>` exist in `npm run dev` only.

- [ ] **Step 1: Write the failing test**

`tests/unit/radio/catalog.test.ts`:
```ts
import { expect, it } from 'vitest';
import { loadCatalog, mergeCatalog } from '../../../src/radio/catalog';
import type { Track } from '../../../src/radio/schema';

const t = (id: string, url = `/a/${id}.m4a`): Track => ({ id, url, title: id, artist: '', credit: 'CC0', duration: 1 });

it('keeps remote stations in order and appends Piano Carols (bundled + remote, deduped)', () => {
  const remote = [
    { id: 'christmas-jazz', name: 'Christmas Jazz', description: '', tracks: [t('j')] },
    { id: 'piano-carols', name: 'Piano Carols', description: '', tracks: [t('p2'), t('dup', '/a/p1.m4a')] },
  ];
  const merged = mergeCatalog(remote, [t('p1')]);
  expect(merged.map((s) => s.id)).toEqual(['christmas-jazz', 'piano-carols']);
  expect(merged[1].tracks.map((x) => x.id)).toEqual(['p1', 'p2']);
});

it('falls back to bundled stations when the remote list fails', async () => {
  const bundled = { version: 0, stations: [{ id: 'piano-carols', name: 'Piano Carols', description: '', tracks: [t('p1')] }] };
  const fetchFn = async (url: string) => (url.includes('credits') ? new Response(JSON.stringify(bundled)) : new Response('nope', { status: 503 }));
  const c = await loadCatalog(fetchFn as typeof fetch);
  expect(c.remoteOk).toBe(false);
  expect(c.stations.map((s) => s.id)).toEqual(['piano-carols']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/radio/catalog.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/radio/catalog.ts`**

```ts
import { PIANO_ID, PIANO_META } from './builtin';
import { parseStationsFile, type Station, type Track } from './schema';

/** Production: Plan 3's endpoint. Development: the dev-music plugin in vite.config.ts. */
export const STATIONS_URL = import.meta.env.DEV ? '/dev-stations.json' : '/api/stations';
const PIANO_URL = '/audio/piano/credits.json';

export function mergeCatalog(remote: readonly Station[], bundledPiano: readonly Track[]): Station[] {
  const out = remote.filter((s) => s.id !== PIANO_ID);
  const remotePiano = remote.find((s) => s.id === PIANO_ID)?.tracks ?? [];
  const seen = new Set<string>();
  const tracks = [...bundledPiano, ...remotePiano].filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
  if (tracks.length) out.push({ ...PIANO_META, tracks });
  return out;
}

async function fetchStations(fetchFn: typeof fetch, url: string): Promise<Station[] | null> {
  try {
    const r = await fetchFn(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return parseStationsFile(await r.json())?.stations ?? null;
  } catch {
    return null;
  }
}

export async function loadCatalog(fetchFn: typeof fetch = fetch): Promise<{ stations: Station[]; remoteOk: boolean }> {
  const [remote, bundled] = await Promise.all([fetchStations(fetchFn, STATIONS_URL), fetchStations(fetchFn, PIANO_URL)]);
  const piano = bundled?.find((s) => s.id === PIANO_ID)?.tracks ?? [];
  return { stations: mergeCatalog(remote ?? [], piano), remoteOk: remote !== null };
}
```

- [ ] **Step 4: Add the dev-music plugin, replacing `vite.config.ts`**

```ts
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const MUSIC_DIR = 'Music MP3s';

/**
 * Dev-only: serves Luke's local test tracks (git-ignored "Music MP3s/") as a "Christmas Classics" station.
 * `apply: 'serve'` guarantees none of this exists in production builds.
 */
function devMusic(): Plugin {
  return {
    name: 'aglow-dev-music',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/dev-stations.json') {
          const files = existsSync(MUSIC_DIR) ? readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|m4a)$/i.test(f)).sort() : [];
          const tracks = files.map((f, i) => ({
            id: `dev-${i}`,
            url: `/dev-music/${encodeURIComponent(f)}`,
            title: f.replace(/\.(mp3|m4a)$/i, ''),
            artist: 'Local test file',
            credit: 'Local test file (never deployed)',
            duration: 0,
          }));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ version: 0, stations: tracks.length ? [{ id: 'christmas-classics', name: 'Christmas Classics', description: 'Local test files', tracks }] : [] }));
          return;
        }
        if (url.startsWith('/dev-music/')) {
          const file = normalize(join(MUSIC_DIR, decodeURIComponent(url.slice('/dev-music/'.length))));
          if (!file.startsWith(`${MUSIC_DIR}/`) || !existsSync(file)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const size = statSync(file).size;
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Type', file.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg');
          const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
          if (m) {
            const start = m[1] ? Number(m[1]) : 0;
            const end = m[2] ? Number(m[2]) : size - 1;
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', String(end - start + 1));
            createReadStream(file, { start, end }).pipe(res);
          } else {
            res.setHeader('Content-Length', String(size));
            createReadStream(file).pipe(res);
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devMusic()],
  build: { target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/unit/radio && npx tsc --noEmit`
Expected: PASS.

Then run `npm run dev` and check two URLs:
- `http://localhost:5173/dev-stations.json` lists the six local test tracks.
- `http://localhost:5173/dev-music/Sleigh%20Ride.mp3` plays in the browser.

Also run `npm run build && ls dist` and confirm no `dev-music` or `.mp3` files are present.

- [ ] **Step 6: Commit**

```bash
git add src/radio vite.config.ts tests/unit/radio
git commit -m "feat(radio): station catalog with bundled fallback and dev-only local music server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Playback engine and the Fireplace synth

**Files:**
- Create: `src/radio/player.ts`, `src/radio/fireplace.ts`

**Interfaces:**
- Consumes: `audio` (Plan 1), `buildQueue`, `nextIndex`, `prevIndex`, `Station`, `Track`.
- Produces:
  - `CROSSFADE_S = 3`.
  - `interface PlayerSnapshot { station; track; playing; position; duration; unavailable }`.
  - `class RadioPlayer(out: () => AudioNode|null)`: `onChange`, `playStation(station, shuffle)`, `next()`, `prev()`, `pause()`, `resume()`, `stop()`, `seek(sec)`, `setShuffle(on)`, `isUnavailable(id)`, `snapshot()`.
  - `class Fireplace`: `running`, `start(ctx, out)`, `stop(ctx)`.

This is audio I/O and is verified by ear in Step 4. The pure parts were tested in Task 2.

- [ ] **Step 1: Implement `src/radio/player.ts`**

```ts
import { audio } from '../audio/context';
import { buildQueue, nextIndex, prevIndex } from './queue';
import type { Station, Track } from './schema';

export const CROSSFADE_S = 3;

export interface PlayerSnapshot {
  station: Station | null;
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  unavailable: boolean;
}

/** One playback deck: <audio> → MediaElementSource → gain → music bus. */
class Deck {
  readonly el = new Audio();
  readonly gain: GainNode;
  constructor(ctx: AudioContext, out: AudioNode) {
    this.el.crossOrigin = 'anonymous'; // required so the analyser can read remote audio
    this.el.preload = 'auto';
    const src = ctx.createMediaElementSource(this.el);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.gain);
    this.gain.connect(out);
  }
}

/** Two decks crossfading through Web Audio (spec §5.2). */
export class RadioPlayer {
  onChange: (() => void) | null = null;
  private decks: [Deck, Deck] | null = null;
  private active = 0;
  private queue: Track[] = [];
  private index = 0;
  private station: Station | null = null;
  private fading = false;
  private failures = 0;
  private playing = false;
  private readonly unavailable = new Set<string>();

  constructor(private readonly out: () => AudioNode | null) {}

  playStation(station: Station, shuffle: boolean): void {
    this.station = station;
    this.queue = buildQueue(station.tracks, shuffle, Math.random);
    this.failures = 0;
    this.load(0, false);
  }

  setShuffle(on: boolean): void {
    if (!this.station || this.queue.length === 0) return;
    const current = this.queue[this.index];
    const rest = this.station.tracks.filter((t) => t.id !== current.id);
    this.queue = [current, ...buildQueue(rest, on, Math.random)];
    this.index = 0;
  }

  next(): void {
    if (this.queue.length) this.load(nextIndex(this.index, this.queue.length), false);
  }

  prev(): void {
    if (this.queue.length) this.load(prevIndex(this.index, this.queue.length, this.activeEl()?.currentTime ?? 0), false);
  }

  pause(): void {
    this.activeEl()?.pause();
    this.playing = false;
    this.onChange?.();
  }

  resume(): void {
    const ctx = audio.unlock();
    const d = this.decks?.[this.active];
    if (!d || !d.el.src || !ctx) {
      if (this.station) this.load(this.index, false);
      return;
    }
    d.gain.gain.cancelScheduledValues(ctx.currentTime);
    d.gain.gain.setValueAtTime(1, ctx.currentTime);
    void d.el.play().catch(() => undefined);
    this.playing = true;
    this.onChange?.();
  }

  stop(): void {
    for (const d of this.decks ?? []) {
      d.el.pause();
      d.gain.gain.cancelScheduledValues(0);
      d.gain.gain.value = 0;
    }
    this.playing = false;
    this.onChange?.();
  }

  seek(sec: number): void {
    const el = this.activeEl();
    if (el && Number.isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(el.duration - 0.5, sec));
  }

  isUnavailable(id: string): boolean {
    return this.unavailable.has(id);
  }

  snapshot(): PlayerSnapshot {
    const el = this.activeEl();
    return {
      station: this.station,
      track: this.queue[this.index] ?? null,
      playing: this.playing,
      position: el?.currentTime ?? 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      unavailable: this.station ? this.unavailable.has(this.station.id) : false,
    };
  }

  private activeEl(): HTMLAudioElement | null {
    return this.decks?.[this.active].el ?? null;
  }

  private ensureDecks(): [Deck, Deck] | null {
    if (this.decks) return this.decks;
    const ctx = audio.unlock();
    const out = this.out();
    if (!ctx || !out) return null;
    const decks: [Deck, Deck] = [new Deck(ctx, out), new Deck(ctx, out)];
    decks.forEach((d, k) => {
      d.el.addEventListener('timeupdate', () => this.onTime(k));
      d.el.addEventListener('ended', () => k === this.active && this.next());
      d.el.addEventListener('error', () => k === this.active && this.onError());
    });
    this.decks = decks;
    this.setupMediaSession();
    return decks;
  }

  /** Switch decks: fade the incoming one in (3s when crossfading, 0.25s on skips) and the outgoing one out. */
  private load(i: number, crossfade: boolean): void {
    const decks = this.ensureDecks();
    const ctx = audio.ctx;
    if (!decks || !ctx || this.queue.length === 0) return;
    const track = this.queue[i];
    this.index = i;
    const incoming = decks[1 - this.active];
    const outgoing = decks[this.active];
    const t = ctx.currentTime;
    const fade = crossfade ? CROSSFADE_S : 0.25;
    incoming.el.src = track.url;
    incoming.gain.gain.cancelScheduledValues(t);
    incoming.gain.gain.setValueAtTime(0, t);
    incoming.gain.gain.linearRampToValueAtTime(1, t + fade);
    outgoing.gain.gain.cancelScheduledValues(t);
    outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, t);
    outgoing.gain.gain.linearRampToValueAtTime(0, t + fade);
    const old = outgoing.el;
    window.setTimeout(() => {
      if (this.activeEl() !== old) old.pause();
    }, fade * 1000 + 50);
    this.active = 1 - this.active;
    this.fading = false;
    this.playing = true;
    incoming.el.play().then(
      () => (this.failures = 0),
      (e: unknown) => {
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          this.playing = false;
          this.onChange?.();
        }
      },
    );
    this.updateMediaSession(track);
    this.onChange?.();
  }

  private onTime(k: number): void {
    if (k !== this.active || !this.decks) return;
    const el = this.decks[k].el;
    if (!this.fading && this.queue.length > 1 && Number.isFinite(el.duration) && el.duration - el.currentTime <= CROSSFADE_S) {
      this.fading = true;
      this.load(nextIndex(this.index, this.queue.length), true);
      return;
    }
    this.onChange?.();
  }

  /** Skip on error; after 3 consecutive failures mark the station unavailable for this session (spec §8). */
  private onError(): void {
    this.failures++;
    if (this.failures >= 3) {
      if (this.station) this.unavailable.add(this.station.id);
      this.stop();
      return;
    }
    if (this.queue.length > 1) this.load(nextIndex(this.index, this.queue.length), false);
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.resume());
    ms.setActionHandler('pause', () => this.pause());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('previoustrack', () => this.prev());
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime !== undefined) this.seek(d.seekTime);
    });
  }

  private updateMediaSession(t: Track): void {
    if (!('mediaSession' in navigator)) return;
    const art = t.cover ?? this.station?.cover;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: this.station?.name ?? 'Aglow',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    });
  }
}
```

- [ ] **Step 2: Implement `src/radio/fireplace.ts`**

```ts
/** Endless procedural fire: low rumble, wandering wind and random crackles (spec §5.2). No audio files. */
export class Fireplace {
  private sources: AudioScheduledSourceNode[] = [];
  private timer = 0;
  private gain: GainNode | null = null;

  get running(): boolean {
    return this.gain !== null;
  }

  start(ctx: AudioContext, out: AudioNode): void {
    if (this.gain) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    g.connect(out);
    this.gain = g;
    const brown = brownNoise(ctx, 6);

    const rumble = ctx.createBufferSource();
    rumble.buffer = brown;
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.value = 0.5;
    rumble.connect(lp).connect(rg).connect(g);

    const wind = ctx.createBufferSource();
    wind.buffer = brown;
    wind.loop = true;
    wind.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    lfo.connect(depth).connect(bp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.18;
    wind.connect(bp).connect(wg).connect(g);

    rumble.start();
    wind.start();
    lfo.start();
    this.sources = [rumble, wind, lfo];
    this.timer = window.setInterval(() => {
      const t = ctx.currentTime;
      for (let k = 0; k < 3; k++) if (Math.random() < 0.28) crackle(ctx, g, t + Math.random() * 0.06, Math.random() < 0.06);
    }, 70);
  }

  stop(ctx: AudioContext | null): void {
    window.clearInterval(this.timer);
    const g = this.gain;
    const sources = this.sources;
    this.gain = null;
    this.sources = [];
    if (!g || !ctx) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    window.setTimeout(() => {
      sources.forEach((s) => s.stop());
      g.disconnect();
    }, 700);
  }
}

function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return b;
}

function crackle(ctx: AudioContext, out: AudioNode, when: number, big: boolean): void {
  const dur = big ? 0.05 : 0.004 + Math.random() * 0.02;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500 + Math.random() * 3500;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = big ? 0.5 : 0.12 + Math.random() * 0.2;
  src.connect(bp).connect(g).connect(out);
  src.start(when);
}
```

- [ ] **Step 2b: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Temporary listening harness** (delete it after Step 4)

Append to the end of `src/main.ts`:
```ts
// TEMP (Plan 2 Task 4): remove after listening check
import { audio as __a } from './audio/context';
import { RadioPlayer as __P } from './radio/player';
import { Fireplace as __F } from './radio/fireplace';
import { loadCatalog as __c } from './radio/catalog';
Object.assign(window, { __radioTest: async (which: 'music' | 'fire') => {
  const ctx = __a.unlock()!;
  __a.music!.gain.value = 0.7;
  if (which === 'fire') return new __F().start(ctx, __a.music!);
  const { stations } = await __c();
  const p = new __P(() => __a.music);
  p.playStation(stations[0], true);
  Object.assign(window, { __p: p });
} });
```

- [ ] **Step 4: Listen**

Run `npm run dev`, click the page once (to unlock audio), then in the console run `await __radioTest('music')`.
Expected: a local test track plays. `__p.seek(__p.snapshot().duration - 5)` crossfades smoothly into the next track after ~2s. `__p.next()` skips with a short fade.

Reload, click once, and run `__radioTest('fire')`.
Expected: a warm fire rumble with irregular crackles and slow wind, and no clicks or repeating pattern over ~30s.

Then **remove the TEMP block from `src/main.ts`**.

- [ ] **Step 5: Commit**

```bash
git add src/radio src/main.ts
git commit -m "feat(radio): crossfading two-deck player with Media Session, and procedural Fireplace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Light show analysis and the Radio facade

**Files:**
- Create: `src/radio/lightshow.ts`, `src/radio/radio.ts`
- Test: `tests/unit/radio/lightshow.test.ts`

**Interfaces:**
- Consumes: `RadioPlayer`, `Fireplace`, `loadCatalog`, `parseEmbed`, `Embed`, `loadRadioSettings`, `saveRadioSettings`, `SCENE_STATION`, `FIREPLACE_ID`, `audio`, `SceneId`.
- Produces:
  - `bandEnergies(bins, binHz)`, `class BeatDetector { update(energy, now): boolean }`, `class LightShow(getAnalyser) { low; sample(now); extraBulb(row, now): number }`.
  - `type SourceKind = 'station'|'fireplace'|'embed'`, `interface RadioView`.
  - `class Radio`:
    - fields: `onChange`, `show`;
    - methods: `firstGesture()`, `setScene(id)`, `select(sourceId)`, `setEmbed(url): Embed|null`, `playPause()`, `next()`, `prev()`, `seek(sec)`, `setVolume(v)`, `setShuffle(on)`, `setLightShow(on)`, `duck()`, `view(): RadioView`, getter `lightShowActive`.

- [ ] **Step 1: Write the failing test**

`tests/unit/radio/lightshow.test.ts`:
```ts
import { expect, it } from 'vitest';
import { BeatDetector, LightShow, bandEnergies } from '../../../src/radio/lightshow';

it('splits spectrum energy into low / mid / high bands (0..1)', () => {
  const bins = new Uint8Array(512);
  for (let i = 0; i < 3; i++) bins[i] = 255; // ~0–129 Hz at 43 Hz per bin
  const e = bandEnergies(bins, 43);
  expect(e.low).toBeGreaterThan(0.5);
  expect(e.mid).toBe(0);
  expect(e.high).toBe(0);
});

it('detects beats as low-energy jumps, with a cooldown', () => {
  const d = new BeatDetector();
  let beats = 0;
  for (let t = 0; t < 2000; t += 20) {
    const kick = t % 500 < 40 ? 0.8 : 0.15;
    if (d.update(kick, t)) beats++;
  }
  expect(beats).toBeGreaterThanOrEqual(3);
  expect(beats).toBeLessThanOrEqual(4);
});

it('pulses bulbs bottom row first after a beat', () => {
  const show = new LightShow(() => null);
  show.beatAt = 1000;
  expect(show.extraBulb(8, 1000 + 30)).toBeGreaterThan(show.extraBulb(0, 1000 + 30));
  expect(show.extraBulb(8, 5000)).toBeLessThan(0.01);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/radio/lightshow.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/radio/lightshow.ts`**

```ts
/** Average energy (0..1) of the bins between two frequencies. */
export function bandEnergies(bins: Uint8Array, binHz: number): { low: number; mid: number; high: number } {
  const avg = (from: number, to: number) => {
    const a = Math.max(0, Math.floor(from / binHz));
    const b = Math.min(bins.length, Math.ceil(to / binHz));
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += bins[i];
    return s / ((b - a) * 255);
  };
  return { low: avg(20, 150), mid: avg(150, 2000), high: avg(2000, 8000) };
}

/** Onset detection on the low band: a jump above the running average, at most one per cooldown. */
export class BeatDetector {
  private avg = 0;
  private last = -Infinity;
  constructor(private readonly threshold = 1.35, private readonly cooldownMs = 180) {}

  update(energy: number, now: number): boolean {
    const beat = energy > 0.08 && energy > this.avg * this.threshold && now - this.last >= this.cooldownMs;
    this.avg = this.avg === 0 ? energy : this.avg * 0.94 + energy * 0.06;
    if (beat) this.last = now;
    return beat;
  }
}

/** Post-win light show (spec §5.4): beats send a pulse up the tree; the low band breathes the glow. */
export class LightShow {
  beatAt = -Infinity;
  low = 0;
  private readonly detector = new BeatDetector();
  private bins = new Uint8Array(0);

  constructor(private readonly getAnalyser: () => AnalyserNode | null) {}

  sample(now: number): void {
    const a = this.getAnalyser();
    if (!a) return;
    if (this.bins.length !== a.frequencyBinCount) this.bins = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(this.bins);
    const e = bandEnergies(this.bins, a.context.sampleRate / a.fftSize);
    this.low = this.low * 0.8 + e.low * 0.2;
    if (this.detector.update(e.low, now)) this.beatAt = now;
  }

  /** Extra brightness for a bulb in `row` (0 = top, 8 = bottom): bottom rows pulse first. */
  extraBulb(row: number, now: number): number {
    const t = now - this.beatAt - (8 - row) * 25;
    return t < 0 ? 0 : 0.9 * Math.exp(-t / 180);
  }
}
```

- [ ] **Step 4: Implement `src/radio/radio.ts`**

```ts
import { audio } from '../audio/context';
import type { SceneId } from '../render/scenes';
import { loadRadioSettings, saveRadioSettings, type RadioSettings } from '../store/radio-settings';
import { FIREPLACE_ID, SCENE_STATION } from './builtin';
import { loadCatalog } from './catalog';
import { parseEmbed, type Embed } from './embed';
import { Fireplace } from './fireplace';
import { LightShow } from './lightshow';
import { RadioPlayer } from './player';
import type { Station, Track } from './schema';

export type SourceKind = 'station' | 'fireplace' | 'embed';

export interface RadioView {
  kind: SourceKind | null;
  playing: boolean;
  station: Station | null;
  track: Track | null;
  position: number;
  duration: number;
  stations: Station[];
  unavailable: (id: string) => boolean;
  embed: Embed | null;
  remoteOk: boolean;
  settings: RadioSettings;
}

export class Radio {
  onChange: (() => void) | null = null;
  readonly show: LightShow;
  private settings = loadRadioSettings();
  private catalog: Station[] = [];
  private remoteOk = true;
  private readonly player = new RadioPlayer(() => audio.music);
  private readonly fireplace = new Fireplace();
  private embed: Embed | null;
  private kind: SourceKind | null = null;
  private started = false;
  private sceneId: SceneId = 'fireside';
  private analyser: AnalyserNode | null = null;

  constructor() {
    this.player.onChange = () => this.onChange?.();
    this.show = new LightShow(() => this.analyser);
    this.embed = this.settings.embedUrl ? parseEmbed(this.settings.embedUrl) : null;
    void this.refreshCatalog();
  }

  async refreshCatalog(): Promise<void> {
    const c = await loadCatalog();
    this.catalog = c.stations;
    this.remoteOk = c.remoteOk;
    if (this.started && this.kind === null && this.settings.on) this.startPreferred();
    this.onChange?.();
  }

  /** Call from every user gesture. The first one fades music in (spec §5.2). */
  firstGesture(): void {
    const ctx = audio.unlock();
    if (!ctx || !audio.music) return;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      audio.music.connect(this.analyser);
    }
    if (this.started) return;
    this.started = true;
    audio.music.gain.setValueAtTime(0, ctx.currentTime);
    audio.music.gain.linearRampToValueAtTime(this.settings.volume, ctx.currentTime + 2);
    if (this.settings.on) this.startPreferred();
  }

  setScene(id: SceneId): void {
    this.sceneId = id;
  }

  select(source: string): void {
    this.stopAll();
    const ctx = audio.unlock();
    if (source === FIREPLACE_ID) {
      if (ctx && audio.music) this.fireplace.start(ctx, audio.music);
      this.kind = 'fireplace';
    } else if (source === 'embed') {
      if (!this.embed) return;
      this.kind = 'embed';
    } else {
      const station = this.catalog.find((s) => s.id === source);
      if (!station || this.player.isUnavailable(station.id)) return;
      this.player.playStation(station, this.settings.shuffle);
      this.kind = 'station';
    }
    this.save({ on: true, source });
  }

  setEmbed(url: string): Embed | null {
    const e = parseEmbed(url);
    if (!e) return null;
    this.embed = e;
    this.settings = { ...this.settings, embedUrl: url };
    this.select('embed');
    return e;
  }

  playPause(): void {
    if (this.kind === 'station') {
      if (this.player.snapshot().playing) this.player.pause();
      else this.player.resume();
    } else if (this.kind === 'fireplace' || this.kind === 'embed') {
      this.stopAll();
    } else {
      this.startPreferred();
    }
    this.save({ on: this.isPlaying() });
  }

  next(): void {
    this.player.next();
  }
  prev(): void {
    this.player.prev();
  }
  seek(sec: number): void {
    this.player.seek(sec);
  }

  setVolume(v: number): void {
    this.save({ volume: v });
    if (audio.music && audio.ctx) audio.music.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.05);
  }

  setShuffle(on: boolean): void {
    this.player.setShuffle(on);
    this.save({ shuffle: on });
  }

  setLightShow(on: boolean): void {
    this.save({ lightShow: on });
  }

  /** Game sounds duck the music ~4 dB for ~250 ms (spec §5.1). */
  duck(): void {
    const m = audio.music;
    const ctx = audio.ctx;
    if (!m || !ctx || !this.started) return;
    const v = this.settings.volume;
    const t = ctx.currentTime;
    m.gain.cancelScheduledValues(t);
    m.gain.setValueAtTime(m.gain.value, t);
    m.gain.linearRampToValueAtTime(v * 0.63, t + 0.03);
    m.gain.linearRampToValueAtTime(v, t + 0.28);
  }

  /** The light show needs analysable audio: our stations or the Fireplace, not embeds (spec §5.4). */
  get lightShowActive(): boolean {
    return this.settings.lightShow && (this.kind === 'station' || this.kind === 'fireplace') && this.isPlaying();
  }

  view(): RadioView {
    const snap = this.player.snapshot();
    return {
      kind: this.kind,
      playing: this.isPlaying(),
      station: this.kind === 'station' ? snap.station : null,
      track: this.kind === 'station' ? snap.track : null,
      position: snap.position,
      duration: snap.duration,
      stations: this.catalog,
      unavailable: (id) => this.player.isUnavailable(id),
      embed: this.embed,
      remoteOk: this.remoteOk,
      settings: this.settings,
    };
  }

  private isPlaying(): boolean {
    return this.kind === 'fireplace' || this.kind === 'embed' || (this.kind === 'station' && this.player.snapshot().playing);
  }

  private preferredSource(): string {
    const s = this.settings.source;
    if (s === FIREPLACE_ID || (s === 'embed' && this.embed)) return s;
    if (s && this.catalog.some((x) => x.id === s)) return s;
    const suggested = SCENE_STATION[this.sceneId];
    if (this.catalog.some((x) => x.id === suggested)) return suggested;
    return this.catalog[0]?.id ?? FIREPLACE_ID;
  }

  private startPreferred(): void {
    const source = this.preferredSource();
    const keep = this.settings.source;
    this.select(source);
    // Following the scene's suggestion isn't an explicit choice: keep `source` as it was.
    this.save({ source: keep });
  }

  private stopAll(): void {
    this.player.stop();
    this.fireplace.stop(audio.ctx);
    this.kind = null;
  }

  private save(p: Partial<RadioSettings>): void {
    this.settings = { ...this.settings, ...p };
    saveRadioSettings(this.settings);
    this.onChange?.();
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/unit/radio && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/radio tests/unit/radio
git commit -m "feat(radio): beat-driven light show analysis and Radio facade with ducking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Radio pill, panel and phone sheet

**Files:**
- Create: `src/ui/radio-panel.ts`, `src/ui/radio.css`

**Interfaces:**
- Consumes: `Radio`, `RadioView`, `EMBED_PRESETS`, `FIREPLACE_ID`, `formatTime`, `el`.
- Produces: `class RadioPanel(radio, fx: { get(): number; set(v: number): void })` mounts into `#radio-slot` and exposes `isOpen` and `close()`.

Design reference: `docs/prototype/radio-mockup.html`, **without** the "My Music" rows or drop zone. Track titles and credits come from data, so always set them with `textContent`, never `innerHTML`.

- [ ] **Step 1: Create `src/ui/radio.css`**

```css
.radio-pill .rp-track { opacity: 0.55; font-weight: 400; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.radio-pill .eq { display: flex; gap: 2px; align-items: flex-end; height: 11px; }
.radio-pill .eq i { display: block; width: 2px; background: var(--accent); border-radius: 1px; animation: eq 1.1s ease-in-out infinite; }
.radio-pill .eq i:nth-child(2) { animation-delay: -0.4s; }
.radio-pill .eq i:nth-child(3) { animation-delay: -0.75s; }
.radio-pill.muted .eq i { animation: none; height: 3px; opacity: 0.5; }
@keyframes eq { 0%, 100% { height: 3px; } 50% { height: 11px; } }

.radio {
  position: fixed; top: calc(68px + env(safe-area-inset-top)); right: calc(28px + env(safe-area-inset-right)); width: 380px;
  max-height: calc(100vh - 96px); overflow: auto; border-radius: 22px; background: var(--panel); border: 1px solid var(--hud-line);
  backdrop-filter: blur(28px) saturate(1.2); -webkit-backdrop-filter: blur(28px) saturate(1.2); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
}
.radio .grab { display: none; }
.radio .now { padding: 22px 22px 16px; display: flex; gap: 16px; align-items: center; }
.radio .art { width: 64px; height: 64px; border-radius: 14px; flex: none; background: radial-gradient(60% 60% at 30% 30%, #ffcf8a, #c0612a 60%, #3a1a0c); background-size: cover; box-shadow: 0 6px 20px rgba(255, 130, 50, 0.25); }
.radio .meta { min-width: 0; }
.radio .station { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent); margin-bottom: 6px; }
.radio .title { font-family: 'Instrument Serif', serif; font-size: 22px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.radio .artist { font-size: 12.5px; opacity: 0.6; margin-top: 3px; }
.radio .prog { padding: 0 22px; }
.radio .scrub { width: 100%; accent-color: var(--ink); }
.radio .times { display: flex; justify-content: space-between; font-size: 10.5px; opacity: 0.45; font-variant-numeric: tabular-nums; }
.radio .ctl { display: flex; align-items: center; justify-content: center; gap: 26px; padding: 8px 0 18px; }
.radio .ctl button { all: unset; cursor: pointer; opacity: 0.85; display: grid; place-items: center; }
.radio .ctl button[aria-pressed='false'] { opacity: 0.4; }
.radio .ctl button:disabled { opacity: 0.2; cursor: default; }
.radio .ctl svg { width: 20px; height: 20px; }
.radio .ctl .play { width: 52px; height: 52px; border-radius: 50%; background: var(--ink); color: #1a0f08; opacity: 1; }
body[data-scene='frost'] .radio .ctl .play { color: #f7f9fa; }
.radio .sec { border-top: 1px solid var(--hud-line); padding: 12px 10px; }
.radio h4 { margin: 4px 12px 8px; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.45; font-weight: 500; }
.radio .st { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 12px; cursor: pointer; }
.radio .st:hover { background: rgba(127, 127, 127, 0.08); }
.radio .st[aria-current='true'] { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.radio .st:disabled { opacity: 0.35; cursor: default; }
.radio .st .n { font-size: 13.5px; font-weight: 500; }
.radio .st .d { font-size: 11.5px; opacity: 0.55; margin-top: 2px; }
.radio .st .r { margin-left: auto; font-size: 11px; opacity: 0.45; }
.radio .st[aria-current='true'] .r { color: var(--accent); opacity: 1; }
.radio .dot { width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center; font-size: 13px; background: rgba(127, 127, 127, 0.1); }
.radio .embed-form { padding: 6px 12px 4px; display: flex; flex-direction: column; gap: 8px; }
.radio .embed-form input { font: inherit; font-size: 12.5px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--hud-line); background: rgba(127, 127, 127, 0.08); color: inherit; }
.radio .presets { display: flex; flex-wrap: wrap; gap: 6px; }
.radio .presets button { all: unset; cursor: pointer; font-size: 11.5px; padding: 6px 10px; border-radius: 999px; background: rgba(127, 127, 127, 0.12); }
.radio .err, .radio .warn { font-size: 11.5px; color: var(--accent); margin: 2px 12px; }
.radio .embed-frame iframe { display: block; width: 100%; border: 0; border-radius: 12px; margin-top: 8px; }
.radio .sl { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 12px; padding: 6px 12px; font-size: 12px; opacity: 0.8; }
.radio .credit { padding: 10px 22px 16px; font-size: 10.5px; opacity: 0.45; line-height: 1.5; }

@media (max-width: 600px) {
  .radio-pill .rp-track { display: none; }
  .radio { top: auto; bottom: 0; left: 0; right: 0; width: auto; max-height: 82vh; border-radius: 26px 26px 0 0; padding-bottom: env(safe-area-inset-bottom); }
  .radio .grab { display: block; width: 38px; height: 4px; border-radius: 2px; background: rgba(127, 127, 127, 0.35); margin: 9px auto 0; }
  .radio .ctl { gap: 32px; }
}
```

- [ ] **Step 2: Implement `src/ui/radio-panel.ts`**

```ts
import { formatTime } from '../core/score';
import { FIREPLACE_ID } from '../radio/builtin';
import { EMBED_PRESETS } from '../radio/embed';
import type { Radio } from '../radio/radio';
import { el } from './dom';

const ICON = {
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c1.6 0 2.7-1 3.6-2.4M14 9.4C15 8 16 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 6h2v12H7zM20 6v12l-9-6z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6h2v12h-2zM4 6v12l9-6z"/></svg>',
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
};

const PANEL_HTML = `
  <div class="grab"></div>
  <div class="now"><div class="art"></div><div class="meta"><div class="station"></div><div class="title"></div><div class="artist"></div></div></div>
  <div class="prog"><input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Seek" /><div class="times"><span class="pos">0:00</span><span class="dur">0:00</span></div></div>
  <div class="ctl">
    <button class="shuffle" aria-label="Shuffle">${ICON.shuffle}</button>
    <button class="prev" aria-label="Previous">${ICON.prev}</button>
    <button class="play" aria-label="Play"></button>
    <button class="next" aria-label="Next">${ICON.next}</button>
    <button class="show" aria-label="Light show">${ICON.show}</button>
  </div>
  <div class="sec"><h4>Stations</h4><div class="stations"></div><p class="warn" hidden>Some stations are unavailable right now.</p></div>
  <div class="sec">
    <h4>Your music</h4>
    <button class="st embed-row"><span class="dot">●</span><span><div class="n">Spotify or Apple Music</div><div class="d">Paste a playlist link</div></span><span class="r">›</span></button>
    <div class="embed-form" hidden>
      <input type="url" class="embed-input" placeholder="Paste a Spotify or Apple Music playlist link" aria-label="Playlist link" />
      <div class="presets"></div>
      <p class="err" hidden>That link isn't a playlist we can play.</p>
    </div>
    <div class="embed-frame"></div>
  </div>
  <div class="sec">
    <label class="sl"><span>Music</span><input type="range" class="vol-music" min="0" max="1" step="0.05" /></label>
    <label class="sl"><span>Effects</span><input type="range" class="vol-fx" min="0" max="1" step="0.05" /></label>
  </div>
  <div class="credit"></div>`;

export class RadioPanel {
  private readonly pill = document.createElement('button');
  private readonly panel = document.createElement('div');
  private stationKey = '';
  private embedSrc = '';
  private scrubbing = false;

  constructor(private readonly radio: Radio, private readonly fx: { get(): number; set(v: number): void }) {
    this.pill.className = 'pill radio-pill';
    this.pill.id = 'radio-pill';
    this.pill.setAttribute('aria-haspopup', 'dialog');
    this.pill.setAttribute('aria-expanded', 'false');
    this.pill.innerHTML = '<span class="eq"><i></i><i></i><i></i></span><span class="rp-name"></span><span class="rp-track"></span>';
    this.panel.className = 'radio';
    this.panel.id = 'radio-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Music');
    this.panel.hidden = true;
    this.panel.innerHTML = PANEL_HTML;
    el('radio-slot').append(this.pill);
    document.body.append(this.panel);
    this.bind();
    radio.onChange = () => this.render();
    this.render();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  close(): void {
    this.panel.hidden = true;
    this.pill.setAttribute('aria-expanded', 'false');
  }

  private q<T extends HTMLElement>(sel: string): T {
    const n = this.panel.querySelector<T>(sel);
    if (!n) throw new Error(`radio panel is missing ${sel}`);
    return n;
  }

  private bind(): void {
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panel.hidden = !this.panel.hidden;
      this.pill.setAttribute('aria-expanded', String(!this.panel.hidden));
      this.render();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.isOpen && !this.panel.contains(t) && !this.pill.contains(t) && t !== el('stage')) this.close();
    });
    this.q('.play').addEventListener('click', () => this.radio.playPause());
    this.q('.next').addEventListener('click', () => this.radio.next());
    this.q('.prev').addEventListener('click', () => this.radio.prev());
    this.q('.shuffle').addEventListener('click', () => this.radio.setShuffle(!this.radio.view().settings.shuffle));
    this.q('.show').addEventListener('click', () => this.radio.setLightShow(!this.radio.view().settings.lightShow));
    const scrub = this.q<HTMLInputElement>('.scrub');
    scrub.addEventListener('input', () => (this.scrubbing = true));
    scrub.addEventListener('change', () => {
      this.scrubbing = false;
      this.radio.seek((Number(scrub.value) / 1000) * this.radio.view().duration);
    });
    const vm = this.q<HTMLInputElement>('.vol-music');
    vm.addEventListener('input', () => this.radio.setVolume(Number(vm.value)));
    const vf = this.q<HTMLInputElement>('.vol-fx');
    vf.addEventListener('input', () => this.fx.set(Number(vf.value)));
    this.q('.embed-row').addEventListener('click', () => {
      const f = this.q('.embed-form');
      f.hidden = !f.hidden;
      if (!f.hidden) this.q<HTMLInputElement>('.embed-input').focus();
    });
    const input = this.q<HTMLInputElement>('.embed-input');
    const submit = (url: string) => {
      const ok = this.radio.setEmbed(url) !== null;
      this.q('.err').hidden = ok;
      if (ok) this.q('.embed-form').hidden = true;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(input.value);
    });
    input.addEventListener('paste', () => setTimeout(() => submit(input.value), 0));
    const presets = this.q('.presets');
    for (const p of EMBED_PRESETS) {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.addEventListener('click', () => submit(p.url));
      presets.append(b);
    }
  }

  private render(): void {
    const v = this.radio.view();
    // pill
    this.pill.classList.toggle('muted', !v.playing);
    const name = !v.playing ? 'Music off' : v.kind === 'fireplace' ? 'Fireplace' : v.kind === 'embed' ? v.embed?.label ?? 'Playlist' : v.station?.name ?? 'Music';
    (this.pill.querySelector('.rp-name') as HTMLElement).textContent = name;
    (this.pill.querySelector('.rp-track') as HTMLElement).textContent = v.playing && v.track ? `· ${v.track.title}` : '';
    if (this.panel.hidden) return;
    // now playing
    this.q('.station').textContent = v.kind === 'fireplace' ? 'Fireplace' : v.kind === 'embed' ? v.embed?.label ?? '' : v.station?.name ?? 'Aglow Radio';
    this.q('.title').textContent = v.kind === 'fireplace' ? 'Crackle & wind' : v.track?.title ?? (v.kind === 'embed' ? 'Press play in the player below' : 'Pick a station');
    this.q('.artist').textContent = v.track?.artist ?? '';
    const cover = v.track?.cover ?? v.station?.cover;
    this.q('.art').style.backgroundImage = cover ? `url("${encodeURI(cover)}")` : '';
    this.q('.credit').textContent = v.track?.credit ?? '';
    const canStep = v.kind === 'station';
    for (const sel of ['.next', '.prev', '.shuffle']) (this.q<HTMLButtonElement>(sel)).disabled = !canStep;
    this.q('.shuffle').setAttribute('aria-pressed', String(v.settings.shuffle));
    const show = this.q<HTMLButtonElement>('.show');
    show.disabled = v.kind === 'embed';
    show.setAttribute('aria-pressed', String(v.settings.lightShow && v.kind !== 'embed'));
    const play = this.q('.play');
    play.innerHTML = v.playing ? ICON.pause : ICON.play;
    play.setAttribute('aria-label', v.playing ? 'Pause' : 'Play');
    // progress
    const scrub = this.q<HTMLInputElement>('.scrub');
    scrub.disabled = !canStep || !v.duration;
    if (!this.scrubbing) scrub.value = String(v.duration ? Math.round((v.position / v.duration) * 1000) : 0);
    this.q('.pos').textContent = formatTime(Math.floor(v.position));
    this.q('.dur').textContent = formatTime(Math.floor(v.duration));
    // stations (rebuilt only when the list or current source changes)
    const key = `${v.stations.map((s) => s.id).join(',')}|${v.kind}|${v.station?.id ?? ''}`;
    if (key !== this.stationKey) {
      this.stationKey = key;
      const box = this.q('.stations');
      box.replaceChildren();
      const rows: { id: string; name: string; desc: string; icon: string }[] = [
        ...v.stations.map((s) => ({ id: s.id, name: s.name, desc: s.description || `${s.tracks.length} tracks`, icon: '♪' })),
        { id: FIREPLACE_ID, name: 'Fireplace', desc: 'Crackle & wind, no music', icon: '✦' },
      ];
      for (const r of rows) {
        const b = document.createElement('button');
        b.className = 'st';
        const current = r.id === FIREPLACE_ID ? v.kind === 'fireplace' : v.kind === 'station' && v.station?.id === r.id;
        b.setAttribute('aria-current', String(current));
        b.disabled = r.id !== FIREPLACE_ID && v.unavailable(r.id);
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.textContent = r.icon;
        const text = document.createElement('span');
        const n = document.createElement('div');
        n.className = 'n';
        n.textContent = r.name;
        const d = document.createElement('div');
        d.className = 'd';
        d.textContent = b.disabled ? 'Unavailable right now' : r.desc;
        text.append(n, d);
        const right = document.createElement('span');
        right.className = 'r';
        right.textContent = current ? 'Playing' : '›';
        b.append(dot, text, right);
        b.addEventListener('click', () => this.radio.select(r.id));
        box.append(b);
      }
    }
    this.q('.warn').hidden = v.remoteOk;
    // embed iframe
    const src = v.kind === 'embed' && v.embed ? v.embed.src : '';
    if (src !== this.embedSrc) {
      this.embedSrc = src;
      const frame = this.q('.embed-frame');
      frame.replaceChildren();
      if (src && v.embed) {
        const f = document.createElement('iframe');
        f.src = src;
        f.height = String(v.embed.height);
        f.allow = 'autoplay *; encrypted-media *; clipboard-write';
        f.loading = 'lazy';
        f.title = v.embed.label;
        frame.append(f);
      }
    }
    // sliders
    this.q<HTMLInputElement>('.vol-music').value = String(v.settings.volume);
    this.q<HTMLInputElement>('.vol-fx').value = String(this.fx.get());
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui
git commit -m "feat(ui): radio pill, desktop popover and phone bottom sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the radio into the app, plus e2e tests

**Files:**
- Modify: `src/main.ts`, `src/app.ts`, `src/ui/menu.ts`, `src/debug.ts`, `tests/e2e/smoke.spec.ts`
- Create: `tests/e2e/radio.spec.ts`

**Interfaces:**
- Consumes: `Radio`, `RadioPanel`, `Settings`, `GRID`.
- Produces: `App.radio` (public readonly), `Menu.sync(settings)`, `AglowProbe.radio()`.

- [ ] **Step 1: Import the radio stylesheet in `src/main.ts`**

Add below `import './styles.css';`:
```ts
import './ui/radio.css';
```

- [ ] **Step 2: Add `sync` to `Menu` in `src/ui/menu.ts`** (below `close()`)

```ts
  /** Keep the menu's copy of the settings in step when they change elsewhere (e.g. the radio's Effects slider). */
  sync(s: Settings): void {
    this.settings = s;
    this.render();
  }
```

- [ ] **Step 3: Edit `src/app.ts`**

Add imports:
```ts
import { Radio } from './radio/radio';
import { RadioPanel } from './ui/radio-panel';
```

Add a field below `readonly renderer: Renderer;`:
```ts
  readonly radio = new Radio();
  private radioPanel!: RadioPanel;
```

At the end of the constructor, add:
```ts
    this.sfx.onSound = () => this.radio.duck();
    this.radioPanel = new RadioPanel(this.radio, {
      get: () => this.settings.effectsVolume,
      set: (v) => this.applySettings({ ...this.settings, effectsVolume: v }),
    });
```

In `applySettings`, after `this.settings = s;`, add:
```ts
    this.menu?.sync(s);
```

In `setScene`, add as the first line:
```ts
    this.radio.setScene(id);
```

In `tap`, replace:
```ts
    this.sfx.unlock();
    if (this.menu.isOpen) {
      this.menu.close();
      return;
    }
```
with:
```ts
    this.sfx.unlock();
    this.radio.firstGesture();
    if (this.menu.isOpen || this.radioPanel.isOpen) {
      this.menu.close();
      this.radioPanel.close();
      return;
    }
```

In `loop`, replace the `this.renderer.frame({ ... });` call with:
```ts
    const show = this.winAt !== null && this.radio.lightShowActive && !this.reduced.matches;
    if (show) this.radio.show.sample(now);
    this.renderer.frame({
      board: this.board, vis: this.vis, now, dt, camera: this.camera, hover: this.hover,
      revealAt: this.revealAt, winAt: this.winAt, reducedMotion: this.reduced.matches,
      extraBulb: show ? (i) => this.radio.show.extraBulb(Math.floor(i / GRID.w), now) : undefined,
      ambient: show ? this.radio.show.low : 0,
    });
```

- [ ] **Step 4: Expose the radio to tests in `src/debug.ts`**

Add to the `AglowProbe` interface:
```ts
  radio(): { kind: string | null; playing: boolean; stations: string[] };
```

Add to the `probe` object:
```ts
    radio: () => {
      const v = app.radio.view();
      return { kind: v.kind, playing: v.playing, stations: v.stations.map((s) => s.id) };
    },
```

- [ ] **Step 5: Keep the Plan 1 smoke test clean when `/api/stations` is absent (preview has no API)**

In `tests/e2e/smoke.spec.ts`, replace the console filter line:
```ts
    if (m.type() === 'error' && !m.text().includes('fonts.g')) errors.push(m.text());
```
with:
```ts
    const src = m.location().url;
    if (m.type() === 'error' && !m.text().includes('fonts.g') && !src.includes('/api/stations')) errors.push(m.text());
```

- [ ] **Step 6: Write `tests/e2e/radio.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import type { AglowProbe } from '../../src/debug';

type W = Window & { __aglow: AglowProbe };

async function ready(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => {
    const a = (window as Window & { __aglow?: AglowProbe }).__aglow;
    return !!a && a.state().interactive;
  });
}
const radio = (page: Page) => page.evaluate(() => (window as unknown as W).__aglow.radio());

test('the radio panel lists stations and plays the Fireplace', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await expect(page.locator('#radio-panel')).toBeVisible();
  await expect(page.locator('#radio-panel .stations')).toContainText('Fireplace');
  await expect(page.locator('#radio-panel .stations')).toContainText('Piano Carols');
  await expect(page.locator('#radio-panel .warn')).toBeVisible(); // preview build has no /api/stations
  await page.locator('#radio-panel .st', { hasText: 'Fireplace' }).click();
  await expect.poll(async () => (await radio(page)).kind).toBe('fireplace');
  await expect(page.locator('#radio-pill')).toContainText('Fireplace');
});

test('a Spotify playlist link becomes an embedded player; junk is rejected', async ({ page }) => {
  await ready(page);
  await page.click('#radio-pill');
  await page.click('#radio-panel .embed-row');
  const input = page.locator('#radio-panel .embed-input');
  await input.fill('not a link');
  await input.press('Enter');
  await expect(page.locator('#radio-panel .err')).toBeVisible();
  await input.fill('https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4?si=abc');
  await input.press('Enter');
  await expect(page.locator('#radio-panel .embed-frame iframe')).toHaveAttribute('src', /open\.spotify\.com\/embed\/playlist\/3rKFTakI4TxtuNLJ1Ruog4/);
  expect((await radio(page)).kind).toBe('embed');
});

test('the first tile tap starts music', async ({ page }) => {
  // Pin the source: the auto scene's suggestion depends on the clock, and Playwright's Chromium lacks AAC.
  await page.addInitScript(() =>
    localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: true, source: 'fireplace', embedUrl: null, volume: 0.7, shuffle: true, lightShow: true })),
  );
  await ready(page);
  const [x, y] = await page.evaluate(() => {
    const a = (window as unknown as W).__aglow;
    return a.tileCenter(a.ids[40]);
  });
  await page.mouse.click(x, y);
  await expect.poll(async () => (await radio(page)).playing, { timeout: 5000 }).toBe(true);
});
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run e2e`
Expected: all unit tests and all e2e tests (5 smoke + 3 radio) pass.

- [ ] **Step 8: Manual check in dev** (the local test tracks appear as Christmas Classics)

Run `npm run dev` and check:
- **First tap:** music fades in. With the auto scene, Frost suggests Classics (the local files), Fireside suggests Jazz (absent in dev, so the first station plays), and Midnight suggests Piano Carols.
- **Ducking:** each rotation briefly dips the music.
- **Pill and panel:** the pill shows station · track. The panel's controls, scrubber, shuffle and next/prev work, and the crossfade at the end of a track is smooth.
- **Mute persists:** the pill play/pause is remembered across a reload (music stays off after the first tap).
- **Light show:** after `__aglow.solve()` (with `?test`), the bulbs pulse to the beat and the ground glow breathes. With Fireplace it reacts to the crackles. With a Spotify embed the light-show button is disabled.
- **Phone:** at 375px width the panel is a bottom sheet.
- **Lock screen / media keys:** play, pause and next work from the system (macOS media keys, or the lock screen on a phone).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: radio wired into the game (autostart, ducking, light show) with e2e coverage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:**

| Spec | Task |
|---|---|
| §5.2 sources | Tasks 1 (Piano), 3 (remote/dev), 4 (Fireplace), 2 and 6 (embeds) |
| §5.2 behaviour: autostart, mute memory, shuffle, crossfade, prev/next/seek, Media Session | Tasks 4, 5, 7 |
| §5.2 fallback | Task 3 |
| §5.2 scene suggestion | Tasks 1, 5 |
| §5.3 UI | Task 6 |
| §5.4 light show | Tasks 5, 7 |
| §5.1 ducking | Tasks 5, 7 |
| §8 errors | Task 4 (skip, unavailable), Task 6 (invalid link, warn) |

- **Cross-plan contract:** Plan 3 must serve `GET /api/stations` returning a `StationsFile` that passes `parseStationsFile`, using the station ids `christmas-jazz` and `christmas-classics`.
