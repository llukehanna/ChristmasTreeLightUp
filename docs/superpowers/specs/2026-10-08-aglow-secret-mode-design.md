# Aglow: secret mode

**Date:** 2026-10-08
**Status:** Approved (design `.superpowers/secret-mode-design.md`, Luke, 2026-10-08); planned in `docs/superpowers/plans/2026-10-08-aglow-secret-mode.md`
**Builds on:** the shipped star-head egg (brief `.superpowers/star-head-brief.md`: `src/ui/star-egg.ts`, `src/render/topper.ts`, `public/star-head.png`, `users.star_head`, `PUT /api/me/star-head`, `localStorage['aglow.starHead']`), the radio (`src/radio/*`, spec `2026-09-29-aglow-design.md` §5) and the radio admin (`/admin`).

Luke's words: "I recall using apps/playing games where there is an alternate 'secret' mode with different visuals and maybe a couple new features." Chosen tone: **a beautiful aurora world with a few hidden jokes of Luke's face.** Marquee track: Gucci Mane, "12 Days of Christmas" (Luke uploads it to the Secret station through `/admin`; the file never enters the repo). Extras: **the head bobs to the beat** (the tree's lights pulse and shift on beats) and **a face-confetti win**.

## Decisions

| Question | Decision |
| --- | --- |
| What turns it on | Secret mode **is** the head mode: the egg's trigger (5 quick star taps, or typing `hohoho`) and its persistence (the account when signed in, else `aglow.starHead`). No new setting, no new storage, no server change for the mode itself. |
| How the world changes | A fourth scene, `aurora` (`AURORA` in `src/render/scenes.ts`), replaces the time-of-day scene while secret mode is on. Turning it on or off by hand sweeps the sky (1.2 s); a load or sign-in switches at once. |
| Luke's face | Exactly one tree bulb, one present and one garland bulb, all drawn from the topper's already-loaded `public/star-head.png`. Picks are deterministic (§3.1). |
| Music | A station with the id `secret` in the stations file, edited in `/admin`. It is listed in the game only in secret mode, and autoplays on a by-hand switch-on (the 5th tap or last letter is the gesture). Empty or missing: a built-in celesta variant of the Music Box. Switch-off restores what the radio was doing. |
| Win ad-lib | Optional `winSound` on the Secret station only: one audio file uploaded to `tracks/secret/`, played on a secret-mode win when game sounds are on. |
| On the beat | A new frame-rate-independent onset tracker (`src/radio/beat.ts`) on the light show's spectral flux (a kick band above the 808 and a click band, rises in dB, weighted against a voice's formants, from its own 2048-point tap, §5.1). It drives the head's nod, a bulb pulse, a palette step on strong beats and the garland face's bob. Gated by the radio's existing light-show setting. |
| Confetti | The win's gold flecks become tumbling mini heads in secret mode; snow flecks stay. Same `CONFETTI_MS` and `CONFETTI_COUNT`. |
| Cost | Cached layers plus at most 3 extra `drawImage` per frame for the sky, at most 4 for the faces, zero canvas or gradient allocations per frame. |

## Non-goals

- No 808 tap sounds and no secret share card (Luke chose neither).
- No change to gameplay, the run log, anti-cheat, replay, the leaderboard, accounts or the share image (it shows whatever is on screen). Secret-mode runs count normally.
- No new image or audio files in the repo. Nothing from `Music MP3s/` is ever read, copied or committed.
- No new user-facing setting. The aurora is not a pickable scene in the menu.
- No Worker route, migration or privacy-page change beyond the stations schema (§4.1) and the admin save check (§4.2).

## 1. The switch

Secret mode is on exactly when the egg is on (`StarEgg.isOn`). `StarEgg` reports every change through a new hook, `mode(on, how)`:

| `how` | When | Scene | Radio |
| --- | --- | --- | --- |
| `'start'` | Constructed (page load), with the stored or account value; also `'quiet'` if a stored head's sticker then fails to load (the egg falls back to the star) | Aurora at once when on (applied by the app's first `applySettings`) | `setSecret(on, autoplay = false)`: nothing plays |
| `'loud'` | The player's own toggle (5th tap, last letter of `hohoho`) | Sweep (§2.4) | `setSecret(on, autoplay = true)` (§4.4) |
| `'quiet'` | Sign-in or `/api/me` brings a different account value | At once, no sweep | `setSecret(on, autoplay = false)` |

A second new hook, `gesture(on)`, runs **synchronously inside** the completing tap or keydown, before the egg awaits the sticker, with `on` = where the toggle is heading. When heading on, the app calls `radio.primeSecret()` there (unlock the context, start the first-gesture fade-in, prime both decks), so the later, asynchronous start of the Secret station is allowed on iOS. This mirrors the radio's existing `pendingStart`.

Timing of a by-hand switch-on: the topper's coin flip starts at `t0` (`FLIP_MS` = 650 ms); the sky sweep starts at `t0 + FLIP_MS / 2` (the face swap) and lasts `SWEEP_MS` = 1200 ms; the music starts at `t0`. Switch-off: the flip back, the reverse sweep from `t0 + FLIP_MS / 2`, the radio restored at `t0`. Under reduced motion the topper crossfades (existing, 300 ms) and the sky crossfades over `SWEEP_FADE_MS` = 300 ms from `t0`.

Toasts are the egg's existing "Ho ho ho." / "Back to the star." (no new toast).

## 2. The aurora world

### 2.1 Scene record (`AURORA` in `src/render/scenes.ts`)

`Scene.light` gains `'aurora'`; `Scene.id` becomes `SceneId | 'aurora'`. `SceneId` (`'midnight' | 'fireside' | 'frost'`) stays the menu's pickable set, so `Settings`, `SCENE_STATION` and the menu are untouched. `sceneFor(id: SceneId, secret: boolean): Scene` returns `AURORA` when `secret`, else `SCENES[id]`.

| Field | Value |
| --- | --- |
| `id` / `light` | `'aurora'` / `'aurora'` |
| `sky` | `['#050a1f', '#140f3d', '#2b1a5e']` (deep navy at the top to violet at the horizon) |
| `ground` | `['#1a2350', '#0a0d24']` |
| `needleA` / `needleB` | `[12, 40, 52]` / `[36, 92, 104]` (cool, teal-tinted fir) |
| `trunk` | `'#0a0c14'` |
| `unlit` (every style) | `{ look: 'plain', wire: 'rgba(190,210,255,.40)', wireW: 0.06, copper: 'rgba(170,190,235,.5)', led: 'rgba(220,235,255,.36)', glass: 'rgba(200,215,255,.12)', glassHi: 'rgba(255,255,255,.34)' }` |
| `bulbFrost` | `0` |
| `core` / `glow` | `'#f2f8ff'` / `'#7fd8ff'` (ice core, ice-blue glow) |
| `copperOn` | `'rgba(170,215,255,.9)'` |
| `neon` / `neonMid` | `'#8a7bff'` / `'#b6a8ff'` (violet) |
| `socket` | `'#3a4466'` |
| `bulbs` | `['#6dffa8', '#4fe6d6', '#7fd0ff', '#8fa2ff', '#b48cff', '#e08cff']`: green, teal, ice, periwinkle, violet, orchid, **in hue order**, so one palette step (§5.3) is a neighbouring hue |
| `starOff` / `starEdge` | `'rgba(220,235,255,.05)'` / `'rgba(220,235,255,.32)'` |
| `hover` / `snow` | `'170,220,255'` / `'235,245,255'` |
| `snowAlpha` / `bloom` | `0.6` / `1` |
| `snowDust` / `reflect` / `embers` | `false` / `false` / `false` |

Places that switch on `sc.light`:

- `paintBackground`: `'aurora'` → `paintAurora` (§2.2).
- `paintTree` lighting pass: `'aurora'` → a vertical gradient from `Y(L, -1)` to `Y(L, 10)`: `0` `'rgba(120,255,210,.14)'`, `0.5` `'rgba(0,0,0,0)'`, `1` `'rgba(0,0,0,.30)'` (aurora light from above), then the existing ambient occlusion.
- `presents.ts` `lighting()`: `'aurora'` → `ambient: [0.18, 0.26, 0.4]`, `face: { front: 0.9, top: 1.4, side: 0.65 }`.
- Everything else already treats non-`'day'` as night (topper dimming, garland, contact shadows, confetti snow).
- `document.body.dataset.scene = 'aurora'`; CSS: `body[data-scene='aurora'] { --ink: #eef0ff; --accent: #9fe7ff; --panel: rgba(12, 12, 40, 0.74); }` and `body[data-scene='aurora'] .radio .art { background: radial-gradient(70% 70% at 50% 62%, rgba(120, 230, 255, 0.24), transparent 70%), linear-gradient(160deg, #1b1650, #070a1e); }`. Share-image ink: `'#eef0ff'` (`shareInk(renderer.scene)` in `src/ui/share.ts`: keyed by the scene on the stage, not the hour's, so a Frost-hour win in secret mode never gets Frost's dark ink on the aurora; the share image is re-rendered only once a sky sweep has landed). The HUD pills and the toast become frosted indigo glass with an ice hairline (`body[data-scene='aurora'] .pill, .toast`): `linear-gradient(180deg, rgba(74,66,168,.42), rgba(20,18,64,.55))`, border `rgba(160,210,255,.4)`, ink `#e6f0ff`. The timer's bulb and the radio pill's equalizer turn ice-blue. The wordmark, menu and radio panel keep their gold and cranberry.

### 2.2 Layers

1. **Static backdrop** (`paintAurora`, into the renderer's cached `bg` canvas, once per resize or scene change), on top of the scene's sky and ground gradients, with `mulberry32(3)`:
   - horizon glow: a radial gradient at `(w/2, hz)`, radius `0.7 w`, `'rgba(150,110,255,.14)'` → transparent;
   - 140 stars in the top 75 % of the sky: radius `0.35 + 0.75 z`, `rgba(225,235,255, 0.05 + 0.5 z²)`;
   - a faint baked haze so a still frame (reduced motion, tier 3) still reads as aurora: `blurredLayer(c, dpr, 1.2 s, …)` with one ellipse at `(0.5 w, 0.25 hz)`, radii `(0.55 w, 0.09 hz)`, `'rgba(90,255,180,.06)'`;
   - the horizon line `'rgba(160,190,255,.12)'`, 1 px; 160 snow glints below it, `1×1` px, `rgba(200,225,255, r·0.3)`.
   (`hz = Y(L, 10.05)` as in every scene.)
2. **Aurora ribbons** (`src/render/aurora.ts`, class `Aurora`): three curtain sprites baked lazily on the first draw after a resize, at `RES = 0.25` sprite px per device px. Each sprite is `ceil(SPAN · L.w · dpr · RES)` × `ceil(hz · height · dpr · RES)` with `SPAN = 1.6`. Baking (as shipped, Task 3 fix round 1):
   - **Gradient:** one vertical gradient per sprite, from `LIFT · h` to `h` (`LIFT = 0.22`). The headroom means a lifted column never cuts its transparent top off at the sprite's edge. Stops: `0` transparent, `0.55` `rgba(rgb, 0.28)`, `0.9` `rgba(rgb, 1)`, `0.97` transparent: a crisp lit hem.
   - **Columns:** for every sprite column `x` (`u = x / w`), the column is filled 1 px wide and raised by `lift = LIFT · (0.5 + 0.5 sin(2π u · waves + phase))` of its height.
   - **Ray height:** each column is scaled vertically about the hem by `reach = 0.65 + 0.35 n₃(x)`, so ray tops are ragged.
   - **Alpha:** `min(1, 1.25 · rays · striae) · ends`, where:
     - `rays = 0.45 + 0.55 sin²(2π u · waves · 4.3 + 2 phase)`;
     - `striae = 0.3 + 0.7 (0.55 n₁(x) + 0.45 n₂(x))^1.4`;
     - `ends = min(1, u / 0.12, (1 − u) / 0.12)`.
   - **Noise:** `n₁`, `n₂`, `n₃` are `rayNoise` value noise (cosine-interpolated `mulberry32(29 + k)` knots, 0..1). Their spacing: `n₁` 46 CSS px; `n₂` and `n₃` 13 CSS px; never under 2.5 sprite px.
   - **Cost:** bake-time only; nothing per frame.

   | k | colour (`rgb`) | `top` (× hz) | `height` (× hz) | `waves` | `alpha` | `phase` | `driftMs` | `shimmerMs` | `breathMs` |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | 0 | `92,255,170` green | 0.06 | 0.42 | 1.7 | 0.55 | 0 | 41 000 | 5 300 | 9 700 |
   | 1 | `70,214,236` teal | 0.08 | 0.34 | 2.6 | 0.40 | 2.1 | 53 000 | 7 100 | 12 100 |
   | 2 | `170,120,255` violet | 0.00 | 0.30 | 1.2 | 0.36 | 4.2 | 67 000 | 8 900 | 15 300 |

   Teal's `top` was 0.14 in the first draft. That put its hem on green's line (both at 0.48 hz), so they stacked into one flat shelf across a desktop sky. At 0.08, teal's hem sits at 0.42 hz: a second, farther curtain.

   Per frame (screen space, CSS px transform, `'lighter'`), ribbon `k` is one `drawImage` at `x = −0.3 L.w + drift`, width `SPAN · L.w`, bottom edge fixed at `hz · (top + height)`, height `hz · height · breath`, alpha `R.alpha · shimmer · a` (`a` is the sweep alpha, else 1), where with `t = now` (or `0` under reduced motion):
   `drift = sin(2π t / driftMs + phase) · DRIFT · L.w` (`DRIFT = 0.12`), `shimmer = 0.78 + 0.22 sin(2π t / shimmerMs + phase)`, `breath = 1 + 0.06 sin(2π t / breathMs + 1.3 phase)`.
   Ribbons drawn by quality tier: tier 0–1: 3; tier 2: 2 (green, teal); tier 3: 1 (green).
3. **Falling snow**: the existing `Snowfall` (back and front layers) with the scene's `snow` and `snowAlpha`.

The tree, presents, garland, bulbs, wire styles (filament, fairy, neon), bloom and topper all re-skin from the scene record; no other layer changes.

### 2.3 Draw order

Unchanged except step 1 of `Renderer.draw`: the backdrop, then (aurora scene or a sweep in progress) the ribbons, then the existing firelight, embers and back snow.

### 2.4 The sweep

`Renderer.setScene(scene, sweep: { now, reduced } | null = null)`. A sweep runs only when `sweep` is given, the stage has been sized, and the change crosses the aurora boundary (one side is `aurora`). Then the old backdrop canvas is kept as `from` and the new one is painted into a second canvas (the spare, allocated once per sweep and released when it ends). `dir` is `'down'` when arriving at aurora, `'up'` when leaving.

`sweepFrame(t, dir, reduced)` (pure, `src/render/aurora.ts`), `t` = ms since the sweep's start (may be negative: not started):

- Not reduced: `k = clamp01(t / SWEEP_MS)`, `e = easeInOutCubic(k)`; `cover = e` (`'down'`) or `1 − e` (`'up'`); `alpha = 1`; `edge = sin(π k)` for `k < 1`, exactly `0` at `k = 1` (`sin(π)` is `1.2e-16`); `done = t ≥ SWEEP_MS`.
- Reduced: `k = clamp01(t / SWEEP_FADE_MS)`; `cover = 1`; `alpha = k` (`'down'`) or `1 − k` (`'up'`); `edge = 0`; `done = t ≥ SWEEP_FADE_MS`.

Drawing while not done (as shipped, Task 3 fix round 1; `SkySweep` and `Aurora.clipSky` / `drawSeam` in `src/render/aurora.ts`):

1. **The leaving or staying sky:** the non-aurora backdrop in full.
2. **The aurora's part:** clipped to the sky above the edge at `y = cover · L.h`, the aurora backdrop at `alpha`, drawn 1:1 in device pixels (no resample at fractional DPRs), then the ribbons at `alpha`.
   - With `edge > 0`, the clip's lower edge billows: 33 path points at `y + amp · seamWave((x − x0) / span)`. Path ops only; no `Path2D`.
     - `seamWave(u) = 0.65 sin(2π · 3.1 u + 0.4) + 0.35 sin(2π · 7.3 u + 2.2)`.
     - `amp = (28 / 80) · hh`, where `hh = min(1.6 L.s, 0.05 L.h)`.
     - The edge sways with the seam: `x0 = (−0.25 + 0.18 sin(2π now / 3600)) · L.w`, `span = 1.5 L.w`.
   - With `edge = 0` (the reduced-motion crossfade, or before the sweep starts), the clip is the plain rectangle `[0, y]`.
3. **The seam, when `edge > 0`:** one `drawImage`, `'lighter'`, alpha `edge`, of a cached 512×128 strip, drawn at `(x0, y − (84 / 80) · hh)`, size `span × 1.6 hh`.
   - **Profile:** 80 rows tall, its hot core on row 84 ± 28 · `seamWave(u)`, so the core rides the clip's edge and hides the backdrop step everywhere. Stops over the profile: `0` `rgba(120,255,200,0)`, `0.45` `rgba(120,255,200,.18)`, `0.68` `rgba(210,255,240,.9)`, `0.74` `rgba(120,255,200,.25)`, `0.82` `rgba(120,255,200,0)`.
   - **Texture:** each column's alpha is `(0.5 + 0.5 (0.6 n₁ + 0.4 n₂)) · ends(3 %)`. Its wash above the core is scaled about the core by `0.55 + 0.45 n₃`. The noise is `rayNoise`, `mulberry32(41)`, spaced 16, 5 and 7 strip columns. So the edge breaks into rays like the curtains' own hem.
4. **Firelight and embers** come from the non-aurora side of the sky while a sweep runs (`fromScene` going down, the new scene going up).
5. **Everything else:** the tree, presents and garland switch to the new scene at the sweep's start (their cached layers repaint at once; the flip covers it).
6. **Ending:** a resize, or a change that doesn't cross the aurora boundary, ends a sweep at once.
7. **Reversal:** a crossing change during a sweep reverses it from where it stands. The arriving and leaving canvases swap, and the clock is mirrored (`at = lastNow − (1 − k) · duration`; `easeInOutCubic` is symmetric), so the cover never jumps.
8. **Under the pause overlay** the app keeps drawing while `Renderer.sweeping`, so a sweep never freezes half-done.

## 3. Luke's face, hidden around

Only while the scene is `aurora` (`Renderer.secret`). All faces come from `FaceSprites` (`src/render/face-sprites.ts`), which reads the topper's loaded sticker (`Topper.image`) and caches, per slot (`'ornament' | 'garland' | 'confetti' | 'paper'`), a lit and a dimmed copy at the requested device-px height, in steps of 8 px (the topper's `cacheHeight`), using the topper's `resample` and `dimmed(…, day = false)` (now exported). Until the sticker has loaded (`FaceSprites.ready` false) every face falls back to the plain bulb, paper or fleck; the renderer re-lays the presents and garland once when it becomes ready.

### 3.1 Which ones (deterministic, `src/render/faces.ts`)

- **Ornament:** `faceBulbTile(solution, ids)`. The bulbs are the tiles of `ids` (ascending) whose solution has degree 1. Hash the solution with FNV-1a 32-bit (offset `0x811c9dc5`, prime `0x01000193`, one step per tile over `solution[i] & 15`); the face is `bulbs[hash % bulbs.length]` (`-1` if there are none). Every tree, seeded, local or resumed, always picks the same bulb; it needs no seed.
- **Present:** `faceGiftIndex(gifts)`: the placed gift with the largest front face `w · h`; the first on a tie; `-1` with no gifts. (Phones: the 1.8 × 1.4 gift; desktop: the 1.5 × 1.45 one.)
- **Garland bulb:** `faceGarlandIndex(geo)`: the bulb in the right swag (`x ≥ swags[1][0]`) whose `x` is nearest that swag's midpoint (it hangs at the swag's low point, nearly straight down, clear of the star); the first on a tie.

### 3.2 How they look

- **Ornament:** in place of the bulb's glass, the socket still pointing at the wire; the sticker upright (also while its tile turns: the turn is undone about the glass centre), height `FACE_ORNAMENT_H · s = 0.56 s` (swelling with the bulb's pop like the glass: × `1 + 0.35 (amt − 1)` when `amt > 1`), centred on the glass centre, its top at `−0.55` of its height. Unlit (pass 1): the dimmed sticker. Lit (pass 2): the lit sticker at alpha `min(1, 0.35 + amt)`. The bulb's halo on the glow layer is unchanged.
- **Present:** the chosen gift's paper becomes `FACE_PAPER = { base: '#22275e', ribbon: '#d8ecff', pattern: 'face', ink: '#22275e' }`. The `'face'` pattern draws the sticker on a staggered grid clipped to each face of the box: `step = max(8, 0.26 w)` CSS px, sticker height `0.78 step`, rows every `0.82 step`, odd rows offset by `step / 2`, alpha `0.92`; the base sprite uses the dimmed sticker, the light sprite the lit one. Each pass multiplies its sticker by a neutral grey for the box face it is printed on (`Tone.print`), so the faces shade with the box and the lit sum stays short of white: the base pass by that face's share of the ambient (normalised so the brightest face is 1); the light pass by its share of the tree's light, with the front at `PRINT_LIGHT = 0.8` and every face capped at 1. The shaded copies are made at layout time and freed at once. Painted only when the presents are laid out (resize, scene change, sticker ready).
- **Garland bulb:** the socket stays in the cached back layer; its glass is left out there and in `drawLit`. `Garland.drawFace` draws, under the socket (top `0.3 z` below the clip point), the sticker at height `FACE_GARLAND_H · z = 1.15 z`: the dimmed copy while the bulb's amount is below 1, the lit copy on top at alpha `min(1, amount)`. It bobs by `garlandBob(...)` bulb sizes (§5.3).

## 4. Music

### 4.1 Stations schema (`src/radio/schema.ts`, `src/radio/ids.ts`)

- `SECRET_ID = 'secret'`: the Secret station's id. It is an ordinary valid station id (only that station may carry `winSound`). The game hides it outside secret mode.
- `CELESTA_ID = 'celesta'`: the celesta's source id. Added to the reserved ids (with `music-box`, `fireplace`, `embed`): no station may use it.
- `Station.winSound?: string`. `parseStation` accepts it only when the station's id is `SECRET_ID` and `isUrl(winSound)` holds; otherwise the station (and so the file) is invalid. Key order of the parsed object: `id, name, description, cover?, tracks, winSound?` (the admin route's lost-response check compares JSON strings).
- The public `GET /api/stations` serves the Secret station like any other.

### 4.2 Worker (`worker/lib/stations-store.ts`, `worker/routes/admin/stations.ts`)

- `isWinSoundUrl(url, base)`: true only if `base` is non-null and `mediaKey(url, base)` starts with `tracks/secret/`. `PUT /api/admin/stations` answers **400** `{ error: 'The win ad-lib must be a file uploaded to the Secret station.' }` when the Secret station has a `winSound` that fails it. This is the "MUSIC_BASE_URL only" rule; the shared schema stays host-agnostic (the browser doesn't know `MUSIC_BASE_URL`).
- `urlsOf` includes `winSound`, so a replaced or removed ad-lib's file is deleted after the save like any media.
- Uploads go through the existing `PUT /api/admin/upload?folder=tracks&station=secret&name=…` (audio types, 30 MB). No new route.

### 4.3 `/admin`

- A station with the id `secret` shows a badge **"Secret mode only"** in the station list.
- While there is no Secret station (and fewer than 20 stations), the list ends with a **"+ Secret station"** button before "+ New station". It adds `{ id: 'secret', name: 'Secret', description: '', tracks: [] }`, selects it and marks the list unsaved. (Creating a station named "Secret" through the form gives the same id: it is the Secret station.)
- The Secret station's editor adds, under the meta row: a note "Secret mode only. The game lists this station only while secret mode is on, and plays it when secret mode is switched on." and a **Win ad-lib** row: an `<audio controls preload="none">` preview when set; a file input labelled "Upload win ad-lib" behind a label button "Add win ad-lib" or "Replace win ad-lib"; a "Remove win ad-lib" button when set; and the hint "Plays once when a tree is solved in secret mode, if game sounds are on." The upload joins the existing queue as kind `'win'` (row text "Win ad-lib: <file name>") and sets `winSound` when it lands.
- `firstProblem` (client validation) adds, for a station with `winSound`: id not `secret` → "only the Secret station can have a win ad-lib."; `!isUrl` → "the win ad-lib link is not valid. Upload it again." (each prefixed with the station's label like the existing messages).

### 4.4 Radio state machine (`src/radio/secret.ts`, pure; driven by `Radio`)

A snapshot of what the radio was doing:

```ts
interface RadioSnapshot {
  /** The audible source: a station id, 'music-box', 'fireplace' or 'embed'; null when nothing is playing (a paused station counts as nothing). */
  source: string | null;
  /** The listener's saved settings then: music on, and the remembered source. */
  on: boolean;
  remembered: string | null;
}
interface SecretState { on: boolean; saved: RadioSnapshot | null }
```

`secretStep(state, event)` → `{ state, effect }`:

| From | Event | To | Effect |
| --- | --- | --- | --- |
| off | `on`, `autoplay` and not `muted` | on, `saved = current` | `play-secret` |
| off | `on`, otherwise (`'start'`, `'quiet'`, or muted) | on, `saved = null` | none |
| on | `on` | unchanged | none |
| on, `saved` | `off` | off, `saved = null` | `restore(saved)` |
| on, no `saved`, a secret source playing | `off` | off | `leave(resume = musicOn)` |
| on, no `saved`, no secret source playing | `off` | off | none |
| off | `off` | unchanged | none |
| any | `choice` (the listener picks another source, play/pause, or sets an embed) | `saved = null` | none |

`muted` is the radio volume at 0. Autoplay happens even if the listener had turned music off ("(or silence)": switch-off restores the silence).

Effects in `Radio`:

- **play-secret:** if the catalog hasn't loaded, set `pendingSecret` and start when it arrives (the decks were primed in the gesture; `pendingSecret` takes precedence over `pendingStart`). Then play `secretSource()`: `secret` if the catalog has it with ≥ 1 track and it isn't marked unavailable, else `celesta`. Never remembered as the listener's source. Shuffle and loop as any station (one track loops).
- **restore(to):** play `to.source` (not remembered) if any; if nothing new took over (no source, or it can't play any more), stop; then persist `on = to.on`, `source = to.remembered`.
- **leave(resume):** stop the secret source; if `resume`, start the preferred source (now non-secret).

Other rules:

- `view().stations` never includes `secret`. `view()` adds `secretMode: boolean` and `secretStation: Station | null` (from the catalog, playable or not).
- `select('secret')` outside secret mode, and `select('celesta')` always, are ignored. `select('secret')` in secret mode plays `secretSource()` and keeps `saved`.
- Preferred source in secret mode (the first tile tap after a load in secret mode, or the play button): the listener's remembered source wins; with none remembered, `secretSource()` is the suggestion (like a scene's suggested station). The catalog fallback ("first playable station") never picks `secret`.
- A Secret station that fails 3 times while playing falls back to the celesta (other stations still fall back to the Music Box).
- The first tile tap still starts the music (remembered source or suggestion) when music is on and nothing is playing, even if secret mode was switched on and off before it. `firstGesture` keeps its own "first move handled" flag instead of relying on the bus's first fade-in, which `primeSecret` may already have done.
- The celesta is kind `'celesta'`: analysable (drives the light show), media-session metadata like the Music Box, next/prev like the Music Box, stopped by play/pause.

### 4.5 The celesta (`src/radio/musicbox.ts`)

`MusicBox` takes a `Timbre` (third constructor argument, default `MUSIC_BOX`). The current constants become `MUSIC_BOX`; the celesta is:

| Field | `MUSIC_BOX` | `CELESTA` |
| --- | --- | --- |
| `mode2` (× f) | 6.267 | 2.756 (a free bar's second mode) |
| `mode2Level` | 0.22 | 0.08 |
| `mode2Decay` (× faster) | 8 | 5 |
| `mode3` (× f) | 17.55 | 5.404 |
| `tineLevel` | 0.18 | 0.05 (felt hammer, not a pin) |
| `tineDecayS` | 0.012 | 0.02 |
| `attackS` | 0.002 | 0.006 |
| `ringScale` (× `ringTime`) | 1 | 1.35 |
| `tempo` (× bpm) | 1 | 0.8 |
| `level` | 0.98 | 0.9 |
| `room.send` / `room.tone` | 0.2 / 3800 Hz | 0.42 / 3000 Hz |
| `room.taps` `[delay s, feedback, pan]` | `[0.067, 0.3, −0.5]`, `[0.103, 0.28, 0.5]` | `[0.137, 0.46, −0.6]`, `[0.211, 0.42, 0.6]` |

`arrange(c, plays, tempo = 1)` uses `60 / (c.bpm · tempo)` seconds per beat. The carols, shuffle and the rest of the synthesis are shared.

### 4.6 Win ad-lib (`src/radio/win-sound.ts`)

`WinSound.preload(url, ctx)` fetches (CORS; the media host sends `Access-Control-Allow-Origin: *`) and decodes once per URL; a failure forgets it so a later call retries. The app preloads when secret mode turns on, and (a page loaded in secret mode has no audio context yet) again on each tile tap while it is on, which fetches only once per URL. On a fresh secret-mode win (not a restored one), at the moment the win chime plays, if the Secret station has a `winSound`, the effects volume is above 0 and the context exists, `WinSound.play` starts it once on the effects bus (so the effects volume applies) and the music ducks for its whole length (`radio.duck(winSound.lastDurationS)`). The radio keeps the hold's end (`duckUntil`): a later game sound's shorter duck re-schedules the bus but never lifts the music before the ad-lib ends; a volume change ends the hold. A URL that failed is left alone by preloads for `WIN_SOUND_RETRY_MS` = 60 s (the win itself still tries). An ad-lib decoded late is dropped if a new tree has started or secret mode has turned off meanwhile. Not decoded within `WIN_SOUND_LATE_MS` = 3000 ms of the win: dropped.

## 5. On the beat

### 5.1 The detector (`BeatTracker`, `src/radio/beat.ts`)

Input: **onset flux**, `e = onsetFlux(db, prev, sorted, binHz)` (`src/radio/lightshow.ts`), one sample per drawn frame at `now` (ms). It is half-wave-rectified spectral flux: the sum of each bin's rise since the last frame, never its fall. The existing post-win `BeatDetector` and `bandEnergies` (bytes from the radio's analyser) are untouched.

- **The beat tap.** The flux reads its own analyser, `BEAT_FFT = 2048` points and `BEAT_SMOOTHING = 0.4`, hung off the radio's analyser (`a.connect(tap)`: an analyser passes its input through, and the radio's is a dead-end tap on the music bus, made once). The radio's 1024-point window is 21 ms, so at 30 fps 12 ms of every frame is never analysed, and a kick's 20 ms of punch can fall into that gap. A 43 ms window leaves none.
  - If the radio hands over a different analyser, the old tap is disconnected and a new one made.
  - If a tap can't be made, the radio's own analyser stands in. It also stands in when the tap hears nothing for `TAP_DEAD_MS = 500` ms while the radio's analyser hears music: a browser that never runs a dead-end node.
  - The float spectrum (`getFloatFrequencyData`, dB, unclamped) goes into reused `Float32Array`s (this frame, the last, and a scratch for a median). Bins come from `binLo` and `binHi`, numbers rather than tuples, so nothing is allocated per frame.
- **Rises in dB.** Each bin is floored at `floorDb = −100` (silence, −Infinity, reads the floor), and its rise since the last frame is capped at `capDb = 40`. In dB, loudness does not matter: a loud master, a quiet volume slider and a ducked bus all give the same flux.
- **Bands** (`FLUX`):
  - The **kick band**, 120–250 Hz. It is the kick's punch, above an 808's fundamental: a held 808 owns the bins below 120 Hz, and in the measurements they even dipped on a kick.
  - The **click band**, 2–6 kHz: the beater's attack.
  - The **duck band**, 24–500 Hz.
  - The **voice band**, from the kick band's top to 4 kHz.
  - The kick and click values are the mean of their bins' capped rises.
- **The limiter's duck.** A hot master's limiter pulls the whole mix down when the kick hits, and that hides the kick's own rise. So the kick band's rises are measured against `duck = max(−duckMaxDb, min(0, median change across the duck band))`, with `duckMaxDb = 3`. The cap means a hard cut, or an unramped duck of the bus, can't pass for a kick: the duck is followed by at most 3 dB a frame.
- **The voice weight.** A rapped voice's fundamental (105–165 Hz) sits in the kick band, and its syllables are sharp onsets. What tells a kick from a syllable is where the frame's **new power** lands: the positive part of each bin's change in linear power, which loudness doesn't change. A kick adds its power low; a syllable adds it in its formants. So the flux is weighted by `share = low / (low + voiceWeight · voice)`, with `voiceWeight = 4`.
- **The weighting.** `e = kick · (1 + clickWeight · click / capDb) · share` with `clickWeight = 0.5`. A kick with its attack counts up to 1.5×. A hat, which is a click with no kick under it, counts for nothing; hats are on every eighth in trap.
- **A fresh start.** The first frame reads 0. After a gap of more than `RESTART_GAP_MS` the last spectrum is stale, and the flux starts again.

```
BEAT = { floor: 4.5, rise: 0.5, ratio: 1.3, tauMs: 300, warmupMs: 300, refractoryMs: 250, strong: 0.6, peakMs: 2000, peakMin: 1.25 }
```

- **Restarts.** The first sample, the clock going backwards, or a gap of more than `RESTART_GAP_MS = 1000` since the last sample (a hidden tab, the music paused: the average is stale) sets `avg = e`, starts the warm-up and gives no beat. A clock that went backwards also forgets the last beat and the peak, which would otherwise lie in its future and block every beat until the clock caught up.
- **The frame step.** `dt = min(100, now − prev)`.
- **An onset** needs all of: `now − start ≥ warmupMs`; `e ≥ floor`; `e − avg ≥ rise`; `e ≥ ratio · avg`; `now − at ≥ refractoryMs`. `floor` (4.5 dB of weighted mean rise) does the work. The other two keep a steady wash of flux, such as noise or applause, from counting.
- **On an onset:**
  - `at = now`.
  - `peak = max(e, peak · exp(−(now − peakAt) / peakMs))`.
  - `strength = beatStrength(e, peak)`: with `ref = max(peak, peakMin · floor)`, it is 1 from `ref` up and otherwise `0.3 + 0.7 · ln(e / floor) / ln(ref / floor)`, so 0.3 at the floor.
  - The log scale suits flux in dB and a hot master's kicks just over the floor. The reference's minimum keeps a song's first onset, just over the floor, from being a full beat.
  - A strong beat (`strength ≥ strong`) increments `strong`.
- **The moving average.** Then `avg += (e − avg) · (1 − exp(−dt / tauMs))`, a time constant, so 30 Hz and 60 Hz frames agree.
- **Reset.** `reset()` forgets everything: `at`, `strength`, `strong` (so the palette starts unstepped), the peak and the average. The app calls it when secret mode turns on.

`LightShow` owns one `BeatTracker` (`show.beat`) and feeds it in `sample()`, after the radio analyser's byte read for the post-win show.

**What counts as a beat.** Any onset that clears all this nods: kicks, and also snares and an 808 note's own start (not its slide). A rapped voice alone rarely does: 1–3 times in 8 s, against every syllable before the voice weight.

**How it was chosen** (amended 2026-10-08, Task 5 review rounds 1–3).

- **Bytes, then amplitude, then floats.** The first input was the byte average of 20–150 Hz. It found no kick under a held bass or pad: the bytes are dB-scaled and sit at 0.75–1.0. Linear amplitude fixed that, but the bytes also clip at −30 dB, and a loud master pinned them. The float spectrum removed the clipping.
- **Spectral flux.** Then mixes with an 808 held at nearly the kick's level still found 0–1 beats: no level of an averaged band moves on a kick there. Spectral flux was tuned in real Chromium on synthesized mixes, rendered in an `OfflineAudioContext` and read through a real `AnalyserNode` once per frame, with a browser's jitter. A kick lifts the 141–188 Hz bins by 8–12 dB even over a held 808, and its click lifts 2–6 kHz by 10–25 dB; pads wobble about ±3 dB per bin.
- **What failed along the way.** Rises in amplitude rather than dB grew with loudness: a loud pad master raised 26–35 false beats. The click band on its own, or added rather than multiplied, made every hat a beat.
- **The voice.** In round 3, the rapped voices raised about 28 false beats in 10 s with the round 2 detector. Gating by dB rise in the mids did not help, because a kick raises quiet mids by many dB too. The power share did: it brought a voice alone to 1–3 false beats. The kick band's own top bin is not counted as voice.
- **The search.** It required every earlier mix to stay at least as good, which gave the floor of 4.5 and a voice weight of 4. The strength mapping was then set so that at least half of every kick mix's beats are strong (the palette steps on them).

`tests/e2e/beat.spec.ts` renders these mixes, each 8 s long and wired as the radio wires the bus. The real `LightShow` samples them. Kicks found (after the warm-up), snares and false beats:

| Mix | 60 fps | 30 fps |
| --- | --- | --- |
| Clean kick, 120 bpm (−20.8 dBFS RMS) | 14/14, 0 false | 14/14, 0 false |
| Kick over a held 808 at near-kick level, 120 bpm (−6.7) | 14/14, 0 false | 14/14, 0 false |
| Trap, 140 bpm half-time: kick, 808, hats on eighths and a roll, snare (−6.4) | 8/8 + snare 1/2, 0 false | 8/8 + snare 2/2, 0 false |
| The same trap, loud mastered: compressor, makeup, limiter (−3.1) | 8/8, 0 false | 6/8, 0 false |
| The same trap, very quiet: bus 0.03 (−32.5) | 8/8 + snare 1/2, 0 false | 8/8 + snare 2/2, 0 false |
| Pads only, chords changing every 2 s (−27.9) | 0 false | 0 false |
| Pads only, loud mastered (−8.5) | 0 false | 0 false |
| A rapped voice alone: formant-filtered saw syllables every 120–180 ms, pitch gliding in 105–165 Hz, plosives, fricatives, breaths (−20.7) | 2 false | 1 false |
| The voice alone, loud mastered (−12.4) | 3 false | 1 false |
| The voice over the trap (−6.3) | 7/8, 0 false | 7/8 + snare 1/2, 0 false |
| The voice over the loud trap (−4.0) | 5/8, 0 false | 6/8, 0 false |
| A sliding 808 alone: legato, gliding 80 ms between notes (−6.4) | 0 false | 1 false |
| Kicks over the sliding 808 (−6.3) | 14/14, 0 false | 10/14, 0 false |
| Holdout, trap at 150 bpm with another pattern, mastered (−3.2) | 9/11, 0 false | 8/11 + snare 3/5, 0 false |
| Holdout, kick over a held 808 at 95 bpm with hats and snares (−6.3) | 11/11 + snare 6/6, 0 false | 11/11 + snare 6/6, 0 false |

Strong beats were 55–100 % of the beats on every kick mix; the spec asserts at least half. The holdouts were never tuned on.

**The cost.** A voice over the beat hides some kicks: a syllable landing on a kick's frame takes part of its share. In the trap-150 holdout, two kicks also sit 200 ms from a snare, inside the refractory.

**Limits.** The spectra are synthesized, not Gucci Mane's master. The live review (Task 7) is the real test, including on an iPhone, where the tap's dead-end analyser is unverified.

### 5.2 When it runs

`beating = secret mode && radio.lightShowActive` (the radio's light-show setting is on and an analysable source, not an embed, is playing). While `beating`, the app samples the light show every drawn frame (before and after the win) and passes `beat = { at, strength, hue }` to the renderer, with `hue = show.beat.strong` (0 under reduced motion). Otherwise, while secret mode is on, `beat = { at: −∞, strength: 0, hue }`: no onset (the head keeps the egg's idle sway after the win, the garland face its idle bob) but the palette step held, so the palette step holds while the music is paused; it starts over when secret mode turns on (`show.beat.reset()`). Outside secret mode, no `beat`.

### 5.3 What moves (`src/render/beat-fx.ts`, pure)

Every beat the detector finds moves these: mostly kicks, and also snares and an 808 note's start (§5.1).

- `nodPulse(t)`: `NOD_MS = 260`; `k = t / NOD_MS`; 0 outside `[0, 1)`; `smooth(k / 0.3)` for `k < 0.3`, then `1 − smooth((k − 0.3) / 0.7)` (`smooth(x) = x²(3 − 2x)`): a quick dip and a slower return.
- **Head nod** (`Topper.nod(at, strength)`): the topper's centre drops by `NOD_DIP · s · n` (`NOD_DIP = 0.09` tiles) and its scale shrinks by `NOD_SQUASH · n` (`NOD_SQUASH = 0.03`), `n = strength · nodPulse(now − at)`. Both passes (glow and body). Not under reduced motion.
- **Bulb pulse** (every beat, lit tree bulbs): `beatPulse(t, strength, reduced)` added to the bulb amount: `0.6 · strength · exp(−t / 180)`, or `0.25 · strength · exp(−t / 250)` under reduced motion; 0 for `t < 0`.
- **Palette step** (strong beats): a lit bulb's colour is `sc.bulbs[(colors[i] + hue) % 6]` (halo and glass; unlit glass keeps its own). Each strong beat moves every lit bulb one neighbouring hue.
- **Garland face bob** (`garlandBob(now, at, strength, reduced)`, in bulb sizes, down): `0.05 sin(2π now / 2400) + 0.16 · strength · nodPulse(now − at)`; 0 under reduced motion.

## 6. The win

- **Confetti:** `Confetti.draw(…, head)` takes the lit `'confetti'` sprite (requested at `29 · dpr` px: the largest fleck at the largest zoom). With a sprite, every gold fleck draws instead as a mini head: height `4 ×` the fleck's size (8.8–16.8 CSS px before zoom), rotated by `0.35 ×` the fleck's spin, foreshortened horizontally by the same `face = |cos(tumble · t + ph)|` (minimum 0.12) as a coin turning, alpha as the fleck's. Snow flecks, the seed, positions, timing (`CONFETTI_MS` = 6500), count (`CONFETTI_COUNT` = 120; halved on tier ≥ 2) and the reduced-motion skip are unchanged.
- **Ad-lib:** §4.6.

## 7. Copy

| Where | Text |
| --- | --- |
| Radio panel, the Secret row's name | the Secret station's name, else "Secret" |
| Radio panel, the Secret row's description | the station's description, else "N tracks" (existing rule); with no playable Secret station: "Dreamy celesta carols" |
| Radio pill and panel heading while the celesta plays | "Secret" |
| Celesta credit line | the Music Box's `creditFor` ("…public domain, arranged for Aglow") |
| `/admin` badge | "Secret mode only" |
| `/admin` button | "+ Secret station" |
| `/admin` note | "Secret mode only. The game lists this station only while secret mode is on, and plays it when secret mode is switched on." |
| `/admin` win ad-lib | label "Win ad-lib"; buttons "Add win ad-lib", "Replace win ad-lib", "Remove win ad-lib"; input label "Upload win ad-lib"; hint "Plays once when a tree is solved in secret mode, if game sounds are on."; upload row "Win ad-lib: <file name>" |
| `/admin` validation | "only the Secret station can have a win ad-lib." / "the win ad-lib link is not valid. Upload it again." |
| Worker 400 | "The win ad-lib must be a file uploaded to the Secret station." |
| Toasts | unchanged: "Ho ho ho." / "Back to the star." |

## 8. Reduced motion

| Piece | Behaviour |
| --- | --- |
| Switch | Sky crossfade over 300 ms from the toggle (no sweep, no seam); the topper's existing 300 ms crossfade |
| Aurora | Ribbons drawn at their `t = 0` pose (no drift, shimmer or breath) |
| Snow | Still (the renderer already passes `dt = 0`) |
| Beat | No nod, no palette step, no garland bob; bulbs pulse gently (`0.25 · strength · exp(−t / 250)`) |
| Confetti | None (existing) |
| Faces | Shown, still; the head's idle sway stays off (existing) |

## 9. Performance budget

The game runs on phones. In secret mode, per drawn frame, beyond the time-of-day scenes:

- **Allocations:** no canvas, gradient, pattern or `Path2D` is created per frame. Caches are (re)built only on resize, scene change, the sticker loading, or a zoom that changes a face's size by an 8 px step. The sweep allocates one full-size canvas at its start and frees it at its end.
- **Sky:** at most 3 `drawImage` of quarter-resolution ribbon sprites (2 on tier 2, 1 on tier 3), plus 1 for the seam during a sweep.
- **Faces:** at most 2 `drawImage` for the ornament (pass 1 dim, pass 2 lit) and 2 for the garland face; the present costs nothing per frame (baked into its sprites).
- **Beat:** one `getByteFrequencyData` (512 bins) and the existing band sums, only while `beating`; the tracker is O(1).
- **Win:** at most 72 mini-head `drawImage` per frame (36 on tier ≥ 2), only during the 6.5 s confetti window, replacing the gold flecks' fills.
- **Memory:** ribbon sprites ≈ (1.6 · 0.25)² of a full backdrop each; four face slots of ≤ 256 px tall sticker copies.
- The quality governor's tiers apply as today; secret mode adds the ribbon counts above.

Unit tests hold the per-frame call counts and the no-allocation rule (§10).

## 10. Test strategy

- **Unit (Vitest):**
  - scenes: `AURORA` fields (6 bulbs, hue order, `light 'aurora'`); `sceneFor`.
  - aurora: `sweepFrame` (both directions, reduced, negative `t`, `done`); `Aurora.draw` with a recording context: 3/2/1 `drawImage` by tier, no `create*Gradient` or canvas creation after the first draw, identical calls at two `now`s under reduced motion.
  - faces: `faceBulbTile` (deterministic, a bulb, spread over trees), `faceGiftIndex`, `faceGarlandIndex` (right swag, at phone and desktop widths); `FaceSprites` (null before load, cached per 8 px step, rebuilt on a size step); the ornament, garland face and confetti heads draw with the expected `drawImage` counts; `Presents.layout` with faces gives `FACE_PAPER` to the chosen gift.
  - beat: `BeatTracker` (onsets on kicks, snares and 808 note starts, refractory, floor, warm-up, strength mapping, the same beats at 30 and 60 fps, strong count); `nodPulse`, `beatPulse`, `garlandBob`; the topper's nod moves it down and never under reduced motion.
  - radio: `secretStep` (every row of §4.4); `Radio` with secret mode (hidden station, autoplay of `secret`, celesta fallback, restore, muted, pending catalog, user choice, no secret fallback outside secret mode, unavailable → celesta); the celesta timbre (`arrange` tempo, `MusicBox` with `CELESTA`); `WinSound` (once per URL, retry after failure, late drop).
  - schema: `winSound` only on `secret` and only a valid URL; `celesta` reserved; `secret` allowed.
  - stations store: `isWinSoundUrl`; `removedMediaKeys` sees `winSound`.
  - admin: `firstProblem` on `winSound`.
  - egg: `mode` (`'start'`, `'loud'`, `'quiet'`, and the failed-sticker path) and `gesture` (synchronous, on the 5th tap and the last letter, with the heading).
- **Worker (Vitest on `getPlatformProxy` D1 and the fake bucket):** `PUT /api/admin/stations` saves a Secret station with a `winSound` under `B/tracks/secret/`; refuses one on another host, under another station's folder or with `MUSIC_BASE_URL` unusable (400 with the message); deletes a replaced ad-lib's file.
- **e2e (Playwright, desktop, the real Worker with fake sign-in; `/api/stations` and the media are routed):**
  - toggling on shows the aurora (`__aglow.secret()`), lists and plays the Secret station (routed silent WAV), and the faces are placed; toggling off restores the Fireplace and unlists it;
  - with no Secret station, switching on plays the celesta, and switching off restores silence;
  - a load in secret mode shows the aurora at once with no sweep and no music; the first tile tap starts the secret suggestion;
  - a muted radio switches the world but plays nothing;
  - `/admin`: "+ Secret station" creates it, it is labelled "Secret mode only", a win ad-lib uploads to `tracks/secret/` and is saved in `winSound`.
- **Visual review:** a live local build for Luke (`npm run serve:e2e` on `:4173`, fake sign-in) before shipping; he judges by playing.

The debug hook (`?test` on a local host) gains `secret(): { on, scene, sweeping, faceTile, faceGift, faceGarland }`, and `radio()` gains `source` (the station id for a station, else the kind) and `secretListed`.

## Rulings on ambiguities in the design

1. **"Reserved id `secret`".** Reserved *for* the Secret station, not refused: `secret` is a valid station id, the only one that may carry `winSound`, hidden by the game outside secret mode. The celesta's new source id `celesta` is the one added to the refused ids.
2. **`winSound` "schema-validated like other media URLs (MUSIC_BASE_URL only)".** Other media URLs are not actually limited to `MUSIC_BASE_URL` by the shared schema (it accepts any https or site-relative URL, and the browser doesn't know the base). So: the shared schema validates `winSound` like other media (`isUrl`) and only on the Secret station; the admin save route additionally requires it to be an upload under `MUSIC_BASE_URL/tracks/secret/`.
3. **Is the Secret station public?** `/api/stations` serves it; the game hides it outside secret mode. The egg is a joke, not a secret worth an authenticated route.
4. **"If sound isn't muted".** Muted = the radio volume at 0. A radio the listener had switched off (Music off) still autoplays on a by-hand switch-on, and switch-off restores the silence (the design's "(or silence)").
5. **Autoplay outside the gesture.** The 5th tap completes before the sticker load resolves, so the gesture primes the radio synchronously (`primeSecret`) and the start follows asynchronously, as `pendingStart` already does.
6. **"Selected/available" after a load in secret mode.** Nothing plays until the first gesture; then, with no remembered source, the Secret station (or celesta) is the suggestion. A remembered source wins.
7. **The listener takes over during secret mode.** Any explicit choice (another source, play/pause, an embed) drops the saved state; switching off then leaves the listener's choice alone. Switching off while a secret source plays with nothing saved stops it and, if music is on, starts the preferred non-secret source.
8. **Sign-in or account changes.** `'quiet'` switches: scene at once, never autoplay; a quiet switch-off still restores a saved state (the autoplay happened in this page).
9. **"The coin flip, then the aurora sweeps".** The sweep starts at the flip's midpoint (when the face changes), 325 ms after the toggle; the music starts at the toggle.
10. **Tree, presents and garland during the sweep.** They switch to the new palette at the sweep's start (cached layers, hidden by the flip); only the sky sweeps.
11. **Which ornament, present and garland bulb.** Ornament: an FNV-1a hash of the tree's solution (every tree has one; local and resumed trees have no seed). Present: the largest front face. Garland: the right swag's lowest bulb.
12. **Beat gating.** The radio's light-show setting gates all beat reactions (one switch for "music moves the visuals"); reduced motion keeps only a gentle bulb pulse. Beat reactions run before and after the win.
13. **A new detector.** The existing post-win `BeatDetector` samples per frame with a fixed per-sample average (frame-rate dependent) and a 180 ms cooldown. Secret mode gets `BeatTracker` (time-constant average, 250 ms refractory, a strength); the post-win show keeps its detector unchanged.
14. **"Shift hue slightly within the aurora palette".** A discrete step to the neighbouring palette colour on each strong beat (the palette is in hue order), on lit tree bulbs only; it costs nothing per frame.
15. **Confetti mix.** The 60 % gold flecks become heads; the 40 % snow stays: same seeded layout, same count.
16. **Win ad-lib volume.** It is a game sound: the effects bus and the effects volume (> 0 to play), with a music duck.
17. **The celesta in the panel.** No separate row: the one Secret row plays the Secret station when it can and the celesta otherwise, described as "Dreamy celesta carols".
18. **A toggle before the first move.** Priming the radio in the egg's gesture would otherwise count as the radio's first gesture, so a player who tries the egg first and turns it off again would get no music on their first move. The first tile tap keeps its own flag and starts the music if it is on and nothing plays.
19. **The marquee track in the local review.** Uploads to the local build land in local R2 but are served from `MUSIC_BASE_URL` (production), so the local Secret station can't play an uploaded file. The local review plays the celesta (its low notes drive the beat); Luke uploads the MP3 through production `/admin` after deploy.
