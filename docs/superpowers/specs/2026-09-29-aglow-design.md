# Aglow — Design Spec

**Date:** 2026-09-29
**Status:** Approved in brainstorming, pending spec review
**URL:** `aglow.lukeghanna.com`
**Reference prototype:** `docs/prototype/aglow-prototype.html` (playable; open in a browser). Radio mockup: `docs/prototype/radio-mockup.html`.

## 1. Goal

A premium, festive web remake of the NovelGames "Christmas Tree Light Up" puzzle (hosted at akidsheart.com). Two rules govern every decision:

1. **The puzzle logic is a faithful copy of the original** — board, generator, randomness, piece orientations, lighting, win condition, scoring.
2. **Everything about delivery is ours to improve** — visuals, feel, sound, music, flow. It must feel impeccable and satisfying to solve.

The throwaway prototype currently in the repo root (`index.html`, `game.js`, `levelgen.js`, `styles.css`, `README.md`) is replaced by this project. It uses a different mask and generator and is not a reference.

## 2. Faithful core (extracted from the original's source)

The original's game code was recovered by decoding `tree_e/assets/__.png` (the engine stores its JS as pixel data). These are the rules to port exactly.

### 2.1 Board

The board is defined by an ASCII mask (`0` = tile, `1` = power source, rows separated by `\r`):

```
       000
      00000
     0000000
    000000000
   00000000000
  0000000000000
 000000000000000
00000000000000000
00000000000000000
        1
```

- Grid width 17, height 10. **97 tiles** (rows of 3, 5, 7, 9, 11, 13, 15, 17, 17).
- The source sits at column 8, row 9. The **root tile** is directly above it (column 8, row 8).
- Direction bits: `U=1, D=2, L=4, R=8`.

### 2.2 Generation (original `Game.Ji`): randomized Prim spanning tree

1. Every tile starts at `0`. Set `root = D` (it connects down to the source). Push frontier edges `(root,U) (root,L) (root,R)`.
2. While the frontier is not empty: pick a **uniformly random** frontier entry `(d, dir)`, compute neighbour `e`.
   - If `e` is in bounds, is a tile, and is still `0`: set `bits[d] |= dir` and `bits[e] = opposite(dir)`, then push the three frontier edges out of `e` that don't point back.
   - Remove the picked entry either way.
3. Result: a spanning tree covering all 97 tiles. There are no loops, and every tile is required.

### 2.3 Scramble (original `Game.Oi`)

Each tile is independently set to a **uniformly random orientation of its own shape class**:

| Class | Orientations |
|---|---|
| End (1 link) | U, D, L, R |
| Straight | U\|D, L\|R |
| Bend | U\|L, U\|R, L\|D, R\|D |
| T | U\|L\|R, U\|L\|D, U\|R\|D, L\|R\|D |
| Cross | U\|D\|L\|R |

Tiles can therefore start already correct. There's no "not already solved" guarantee, which is also the original's behaviour.

Each tile also gets `colour = floor(random * 6)` (original `Block.xi`). It is only visible on end tiles, which carry a bulb.

### 2.4 Rotation (original `Block.hm` / `rotate`)

- A click rotates the tile **90° clockwise**: `U→R, R→D, D→L, L→U`.
- **While the tile is turning, its bits are `0`**, so it and everything downstream go dark. Lighting is recomputed at the start and end of the turn.
- Other tiles can turn at the same time.
- Clicks are ignored once the tree is solved.

### 2.5 Lighting (original `Game.og` / `Ke`)

- Breadth-first search from the root, which is lit only if it has its `D` bit.
- Neighbours are checked in the order U, D, L, R.
- A neighbour becomes lit if both tiles have the facing bits and the neighbour isn't already lit.

### 2.6 Win and score (original `Game.Fi`)

- **Win:** every tile is lit.
- On win: the star lights, input locks, and `score = 50000 − 100 × seconds`, where `seconds` is the integer number of seconds elapsed.
- The timer shows whole seconds.

### 2.7 Deliberate deviations (approved)

| Original | Aglow | Why |
|---|---|---|
| Turn takes 200ms, linear | **120ms** with a snappy ease-out and slight overshoot | Snappier feel (Luke's request) |
| Clicks during a turn are ignored | **Buffered, max 3 queued**: rapid taps chain into one fluid spin | Responsiveness |
| Timer starts when the board is created | Timer starts when the reveal animation ends and tiles become interactive; it stops while the game is paused (pause pill, `P`, or a hidden tab) | Fairness |

Consequence: times aren't directly comparable with the original. The puzzle rules themselves are unchanged.

## 3. Architecture

- **Front end:** Vite + TypeScript, no framework.
- **Backend:** a few Vercel serverless functions for admin, plus Vercel Blob for music storage.
- **Hosting:** a new Vercel project in team `lllukehanna-8723's projects`. Domain `aglow.lukeghanna.com` is added through a CNAME in Cloudflare, where lukeghanna.com's DNS lives. Its web hosting is already on Vercel.

```
src/
  core/        pure TS, no DOM; the faithful port. 100% unit tested.
    mask.ts        mask parsing, W/H/cells/root/source
    generate.ts    Prim spanning tree (RNG injected)
    scramble.ts    orientation classes + scramble
    board.ts       state, rotate/queue, lighting BFS (parent/entry/children), win
    score.ts       score + time formatting
  render/      Canvas 2D renderer
    scene/*.ts     Midnight, Fireside, Frost: background + procedural fir (pre-rendered)
    paths/*.ts     Filament, Fairy lights, Neon light-path styles
    bloom.ts       glow layer + blur composite, with a sprite fallback where canvas blur filters are missing
    effects.ts     flow animation, flashes, frontier sparks, particles, snow, embers, star
    quality.ts     adaptive quality (frame-time monitor)
  audio/
    sfx.ts         synthesized tick / wave / chimes / win (Web Audio, no assets)
    radio.ts       station playback, crossfade, ducking, Media Session
    fireplace.ts   procedural crackle + wind
    embed.ts       Spotify / Apple Music embed parsing + mini player
    analyser.ts    beat/energy extraction for the light show
  ui/          HUD, radio panel/sheet, settings menu, results card, share, toasts
  store/       localStorage: in-progress game, stats, settings
api/           Vercel functions: admin session, Blob upload token, station writes
admin/         admin page (same stack)
tests/         vitest (core) + Playwright (smoke)
```

**Boundaries:**
- `core` knows nothing about rendering.
- The renderer reads board state plus visual timing (`litStart`, `fadeStart`, `settleT`, flash events) and never mutates rules.
- Audio subscribes to board events (`rotateStarted`, `wave(newlyLit, bulbTimes)`, `won`).

## 4. Visual design

### 4.1 Principles

- **Light is the hero.** Keep restraint, darkness and negative space.
- **No cartoon shapes:** no outlines, flat saturated fills or scalloped tiers.
- **Depth** comes from layered blur, film grain, vignette, a real glow (bloom) effect, and light that falls on its surroundings.
- **No square tiles.** Wires sit directly on the tree. Hit areas are invisible grid cells.

### 4.2 Layout

- The board fills the viewport. The tree is centred with the star above row 0 and the source in the trunk below the root.
- Tile size: `s = min(availableHeight / 12.7, width × 0.9 / 20)`. Throughout this spec, sizes written as `0.06s` are multiples of `s`.
- **Wordmark:** "Tracked" style, top-left. `AGLOW` in Inter, ~11.5px, letter-spacing 0.52em, set in gold foil and preceded by a small holly sprig whose berries glow with the lit fraction (§4.8).
- **HUD:** top-right. Radio pill, timer pill (tabular numerals), a pause pill (a two-bar glyph, `aria-label="Pause"`; hidden during the reveal and after the win), and a `···` settings button. The pills are cranberry glass with a gold hairline and backdrop blur (§4.8).

### 4.3 Scenes

Each scene is a palette plus background and lighting. All share the procedural fir.

- **Procedural fir** (pre-rendered on layout or scene change):
  - A soft, heavily blurred, tapered body underneath.
  - Three needle passes (back blurred, middle, front crisp): around 50 branch whorls, curved drooping branches, and paired needle strokes.
  - Per-scene side lighting via `source-atop`, plus a soft darkening near the centre for depth.
- **Midnight:**
  - Deep indigo sky, faint stars, cool light in the upper right.
  - A line of tiny warm village lights on the horizon, and a few defocused cool out-of-focus lights.
  - A snowy ground plane and snow falling at two depths.
  - Cool moonlight on the right side of the tree.
- **Fireside** (Luke's favourite; used for the prototype and marketing imagery):
  - A warm dark room with faint wall planking and an out-of-focus garland across the top of the frame.
  - Animated flickering firelight from the lower left, plus drifting embers.
  - The tree is lit warmly from the left side.
  - A dark wood floor with a **blurred reflection of the lights**. There is no snow.
- **Frost:**
  - Snowy daylight: pale sky, a band of mist on the horizon, a snow ground with a soft tree shadow.
  - A dense, dark fir with sparse snow dusting on the branches.
  - Grey-blue falling snow and lower glow intensity (`bloom: 0.7`).
  - Unlit wires, LED runs and tubes are paler and heavier than at night (filament ~0.07s, with a thin dark casing on wires and LEDs) and unlit bulbs are muted frosted glass with a pale rim, so the whole puzzle stays readable on the dark fir in daylight without looking lit.
- **Scene selection:** Auto by local time (default) — Frost 07:00–16:00, Fireside 16:00–20:00, Midnight 20:00–07:00 — or a manual choice that is persisted.

### 4.4 Light paths (all three offered in settings; default Filament)

**Geometry (shared):**
- **Bends** are quarter arcs of radius `s/2` centred on the shared corner, so paths meet the next tile smoothly with no kink.
- **Straights, Ts and crosses** are drawn as spokes from each edge midpoint to the centre, with a junction node.
- **End tiles** are a single spoke ending in the bulb.

**Styles:**
- **Filament:** unlit is a ~0.06s hairline (Frost: 0.07s, cased). Lit is a 0.2s glow, a 0.078s warm core and a 0.03s white-hot centre. Spark particles run from the source outward along the tree's branches.
- **Fairy lights:** a copper wire with micro-LEDs every 0.2 tile. Lit LEDs (0.11s glow each) twinkle with per-LED phase.
- **Neon:** a glass tube (outer glass, inner shadow, specular line). Lit tubes fill with glowing gas (a 0.34s glow) and **flicker on** (a 7-step stutter over about 260ms) when they light.

**Bulbs:**
- Glass spheres with a metal socket facing the wire.
- Unlit: dark coloured glass with a specular highlight (Frost: muted frosted glass with a pale rim).
- Lit: a near-white core tinted with the colour, plus a coloured halo (radius 0.8s before bloom).
- Six colours per scene palette.

### 4.5 Solving feedback ("visually satisfying" requirements)

1. **Light flow:**
   - Newly lit tiles light in BFS order. Each tile fills over 30ms, starting when its parent finishes.
   - Within a tile, light travels from the entry edge to the centre, then out along each exit, or along the arc for bends.
2. **Hot head:** a white-hot point with a glow leads the flow front.
3. **Connection flash:** at each point where a newly lit subtree joins, a white-to-glow burst plus an expanding ring, 480ms.
4. **Settle bounce:** on turn completion the tile scales 1 → 1.1 → 1 over 240ms.
5. **Bulb pop:** brightness overshoots (to about 1.8×, then back to 1) with a horizontal and vertical glint that fades over 520ms.
6. **Frontier sparks:** every lit wire end that isn't connected pulses gently, showing where light is trying to go next.
7. **Fade out:** tiles that lose power fade over 170ms.
8. **Auto-exposure:** exposure is `1 − 0.5 × litFraction^1.3`. Each bloom pass takes it to its own power (tight √, soft ×1, wide ²), so a well-lit tree loses its fog first while the lit lines keep their warm halo, and a fully lit tree stays legible.
9. **Ground pool:** the snow or floor under the tree brightens with the lit fraction. The star warms slightly as the tree nears completion.
10. **Win:**
    - The star ignites with a scale-in and an anamorphic flare.
    - A brightness wave sweeps through the bulbs from bottom to top.
    - The light show starts (§5.4). The results card appears after about 1.5s.
11. **Hover** (desktop): a soft radial light under the cursor tile, with a pointer cursor.
12. **Reveal** on a new tree: tiles fade in row by row from the bottom (55ms per row). The source then "switches on" and the initial connected region flows out.

### 4.6 Rendering pipeline (per frame)

1. Background (pre-rendered) and dynamic background elements: firelight flicker, embers, back snow.
2. Tree (pre-rendered).
3. Hover.
4. Pass 1: unlit wires and bulbs, drawn rotated or scaled per tile. Glow layer (half resolution): lit glow, halos, frontier, flashes, source, ground pool, star glow, particles.
5. Bloom: three blurred copies of the glow layer composited additively: a tight halo (radius 0.14s, weight 0.95), a soft glow (0.45s, 0.55) and a faint atmosphere (1.3s, 0.22), each scaled by auto-exposure (§4.5 item 8) and the scene's `bloom`. The glow stays a halo around the line, not a fog: unlit tiles next to lit ones must stay legible.
6. Fireside only: the glow layer mirrored and blurred below the horizon as the floor reflection.
7. Pass 2: lit cores, lit bulbs, glints, frontier cores, flash rings, source, particle cores.
8. Star, then front snow. Grain and vignette are CSS overlays.

**Adaptive quality** (drop one tier after about 1s of frames over 22ms, recover after about 5s under 18ms):
- Tier 1: two bloom passes.
- Tier 2: half the particles and snow.
- Tier 3: no reflection or embers.

**Blur fallback:** where `ctx.filter` blur isn't supported (older Safari), downsample the layer to about 1.6/radius of its size and scale it back up with smoothing (an approximate Gaussian). The same helper blurs the static background and tree layers. The look must match within reason.

While the game is paused, rendering draws one blurred frame and then idles; the browser stops it entirely while the tab is hidden.

### 4.7 Motion and accessibility

- `prefers-reduced-motion` keeps the light flow but removes flashes, the settle bounce, snow drift and the light-show pulsing (the lights stay lit and steady).
- Bulb states never rely on colour alone: unlit bulbs are dim glass and lit ones glow.

### 4.8 Festive layer (approved 2026-09-29)

Luke asked for the UI to be more festive. The approved mockups are `docs/prototype/festive-mockup.html` and `docs/prototype/icons-mockup.html`. The festive mockup iframes the live game at `/?test`, so view it by copying it into `dist/` and serving with `vite preview`. §4.1 still applies: every festive element has depth and receives light, with no flat cartoon fills.

- **Icon:** option 15 in `icons-mockup.html` ("Tree on cranberry"): the lit tree with glowing wires, bulbs and a gold star on a cranberry tile.
- **Garland progress:** a swag of C9 bulbs on a dark wire across the top of the frame, below the HUD, in focus and in front of the Fireside out-of-focus garland.
  - Bulb *k* of *n* lights once `litFraction ≥ (k + 1) / n`, using the palette colours in order.
  - On the win, every bulb blazes, then the garland chases during the light show.
  - It is drawn in the canvas, so it takes bloom, and it appears in every scene.
- **Chrome:**
  - Gold-foil wordmark with a holly sprig in place of the dot.
  - Cranberry-glass pills with a gold hairline and a warm top highlight. The timer pill has a small glowing bulb.
  - The intro line is set in gold Instrument Serif italic.
- **Presents:** wrapped gifts on the floor or snow, drawn in the canvas.
  - They are shaded, catch the tree's light (dark when unlit, warming with the lit fraction), and are reflected on the Fireside floor.
  - On phones they sit in front of the tree below the ground line. On desktop they flank the tree base.
  - They never overlap a tile's hit area.
- **Gift-wrap menu:** the settings sheet has a gold ribbon band and bow on a deep cranberry panel. Selected segments are gold, and New tree is red.
- **Gift-tag results:** a cream tag with notched top corners, a gold-ringed eyelet, a red serif time, a "Merry & bright" line and red primary buttons.
- **Win confetti:** gold flecks and snow fall over the solved tree. This is dropped under `prefers-reduced-motion`.
- The Frost scene keeps the same festive elements, with contrast tuned for its light background.

## 5. Sound and music

### 5.1 Game sounds (synthesized, Web Audio, no files)

- **Tick** on each turn (and each buffered tap): a short pitched sine drop plus a band-passed noise click.
- **Wave:** a filtered noise swell scaled by how many tiles lit.
- **Chimes:** one bell per newly lit bulb, timed to its pop, climbing a G-major pentatonic scale, capped at 14 per wave. The bell tone is four sine partials with fast attack and slow decay.
- **Win:** a rising arpeggio plus a resolving low chord.
- **Mix:** master → compressor, plus a short feedback-delay "room" send. Game sounds duck the music by about 4dB for about 250ms.
- **Volume:** an Effects slider (persisted) and the settings toggle.

### 5.2 Radio

**Sources:**

| Source | Content | Notes |
|---|---|---|
| **Christmas Jazz** | Uploaded by Luke via admin | Public station |
| **Christmas Classics** | Uploaded by Luke via admin | Public station |
| **Piano Carols** | Public-domain carols, solo piano, CC0/PD recordings (e.g. Musopen) | Seeded by us; also admin-managed |
| **Fireplace** | Procedural crackle and wind (`fireplace.ts`) | No files; always available |
| **Spotify / Apple Music** | Official embeds: preset playlists, or a pasted playlist link | Full tracks only for listeners signed in to that service; otherwise 30-second previews. No light show. |

**Copyright:** uploaded Jazz/Classics tracks are Luke's responsibility. The credit field is shown for every track, and CC-BY requires it.

**Behaviour:**
- Music fades in on the player's **first tile tap**.
- Tapping the pill to mute is remembered. Station, volume and play state persist in localStorage.
- Shuffle is on by default, with a 3-second crossfade between tracks.
- Previous, next and a seekable scrubber.
- Media Session metadata and actions for lock-screen and media-key control.
- If `stations.json` can't be fetched, show Piano Carols (a small bundled fallback set) and Fireplace only.
- Each scene suggests a matching station without forcing it: Fireside with Christmas Jazz, Midnight with Piano Carols, Frost with Christmas Classics.

**No local file upload.** Players don't drop MP3s; Luke rejected it as dated.

### 5.3 Radio UI (see `docs/prototype/radio-mockup.html`)

- **Collapsed:** a pill showing equalizer bars, the station name, and the track title in a dimmer weight. When muted it reads "Music off".
- **Desktop:** a 380px glass popover below the pill; the game stays playable behind it. It contains:
  - Now playing: generated glowing-bulb cover art in the scene palette (or the uploaded cover), the station label in the accent colour, the title in Instrument Serif, and the artist.
  - Scrubber with times.
  - Controls: shuffle, previous, play/pause, next, light-show toggle.
  - Stations list, then a "Spotify or Apple Music" entry that opens a link field and presets.
  - Music and Effects sliders, and the credit line.
- **Phone:** the same content as a bottom sheet with a grab handle and larger controls.

### 5.4 Light show

- Enabled by default after winning, for Web Audio sources only (stations and Fireplace). The toggle is greyed out for embeds.
- An `AnalyserNode` provides energy in low, mid and high bands plus simple onset (beat) detection.
- **Mapping:**
  - Beats: bulb brightness pulses, staggered by row.
  - Low band: breathing of the ground pool and star glow.
  - Highs: fairy-LED twinkle speed and filament particle rate.
- The show runs while the solved tree is shown and stops on New tree. It respects reduced motion.

## 6. Game flow

1. **Arrive:** the scene and dark tree render, and `AGLOW` plus "Turn the wires. Light the tree." fade in (about 1.5s). The tile reveal plays, then the timer starts. On the first visit, the hint stays until the first tap.
2. **Resume:** an in-progress game (solution, current bits, colours, elapsed ms, scene) is saved to localStorage on every turn and on page hide. On return: a "Welcome back · 1:42" toast and the timer resumes.
3. **Pause:** the HUD pause pill, the `P` key, or hiding the tab all pause the game the same way: the timer stops, the game is saved (if a tile has been turned), and the board is blurred behind "Paused — tap to resume". Tapping anywhere, `P` again, or `Escape` resumes (the settings dialog keeps its own `Escape`); the resuming tap never turns the tile underneath. There is no pause during the reveal or after the win: hiding the tab then shows no overlay (the clock isn't running during the reveal, and a moved game is still saved). While paused, the HUD and settings are inert and game sounds are silent.
4. **New tree mid-game:** tapping it turns the button into "Tap again to start over" for 3 seconds.
5. **Settings (`···`):** Scene (Auto / Midnight / Fireside / Frost), Light path (Filament / Fairy lights / Neon), Effects volume, Haptics (Android only; `navigator.vibrate(8)` on each turn).
6. **Win:** the sequence in §4.5, then the **results card**:
   - "Lit in 1:24" in Instrument Serif italic.
   - The score, and a **New best** badge or "Best 1:02".
   - Solved count, average time and daily streak.
   - Actions: **New tree** (primary), **Share**, **Keep watching** (dismisses the card; a small "New tree" pill remains).
7. **Share:**
   - Render a 1080×1350 image of the player's lit tree in their scene, with the time and `aglow.lukeghanna.com`.
   - Phones: the Web Share API with the image file. Desktop: copy the image to the clipboard, plus the text "Lit the tree in 1:24 · aglow.lukeghanna.com", with text-only fallback.
   - A static Open Graph image is used for link previews.
8. **Stats** (localStorage): best time, best score, solved count, total time (for the average), current and longest daily streak, last solve date.

### 6.1 Input

- **Pointer:** `pointerdown` rotates the tile under the pointer.
- **Hit testing:** hit areas are complete grid cells, with no dead zones between tiles.
- **Phones:** in portrait the tree fits the screen width (tiles about 20px). Pinch-zoom and pan are supported; a "Reset view" pill appears while zoomed (double-tap is not used, because double-tapping a tile means two turns). Page scroll and zoom are disabled on the canvas.
- A tap on a turning tile is buffered (§2.7).

## 7. Admin

- **`/admin`** is a separate Vite entry using the same design language, so it's usable on a phone.
- **Auth:**
  - `POST /api/admin/login` compares against the `ADMIN_PASSWORD` environment variable using a constant-time comparison.
  - It sets an HttpOnly, Secure, SameSite=Strict cookie holding an HMAC-signed session (`ADMIN_SECRET`) that lasts 7 days.
  - A basic rate limit applies to login attempts.
- **Stations:** create, rename, set description, reorder and delete.
- **Tracks:**
  - Upload via Vercel Blob client uploads. `POST /api/admin/upload-token` issues a token only for a valid session; the allowed types are `audio/mpeg`, `audio/mp4`, `audio/aac` and `audio/ogg`, up to 30MB.
  - Duration is read client-side.
  - Edit title, artist, credit and cover image; reorder; delete (which also deletes the blob).
- **Data:**
  - `stations.json` in Blob (public read, no-cache), containing `{version, stations:[{id, name, description, cover?, tracks:[{id, url, title, artist, credit, duration, cover?}]}]}`.
  - Writes go through `PUT /api/admin/stations`: the session is validated, then a read-modify-write with a `version` check (optimistic concurrency).
- **Cost:** Vercel Blob storage and transfer. About 100 tracks is roughly 500MB, which fits the Hobby tier at modest traffic. Watch usage in December.

## 8. Error handling

| Failure | Behaviour |
|---|---|
| Audio blocked before a gesture | Silent until the first tap, which is also when music starts. No error UI. |
| `stations.json` fetch fails | Bundled Piano Carols fallback plus Fireplace, and a quiet "Some stations unavailable" line in the panel |
| Track fails to load or decode | Skip to the next track. After 3 consecutive failures, mark the station unavailable for the session. |
| Invalid Spotify/Apple link | Inline "That link isn't a playlist we can play" message |
| Canvas blur filter unsupported | Downsample-then-upsample blur (§4.6) |
| Low frame rate | Adaptive quality tiers |
| localStorage unavailable or corrupt | Treat as a fresh player. Wrap every read and write in try/catch. Validate a saved game against the mask before restoring it; discard it if invalid. |
| Admin API errors | Toast with the message. An upload is retried once. A version conflict prompts a reload. |

## 9. Testing

**Unit tests (vitest) for `core/`:**
- The mask parses to W=17, H=10, 97 tiles, source (8,9), root (8,8).
- The generator, over 1,000 seeded runs, always produces:
  - all 97 tiles non-zero;
  - bits that are symmetric between neighbours;
  - no link pointing out of bounds or off the mask;
  - exactly 96 links (a tree);
  - every tile connected to the root;
  - `root & D`.
- Scramble preserves shape class; the orientation distribution is uniform (chi-square test with a loose bound).
- `rotCW` applied four times is the identity; the mapping is U→R→D→L.
- Lighting:
  - The solved board lights all 97 tiles.
  - A turning tile (bits 0) darkens exactly its subtree.
  - The root without `D` lights nothing.
  - BFS order and entry directions are correct.
- Queue: three buffered taps give three clockwise turns, and the tile stays dark throughout the chain.
- Win and score: 84 seconds gives 41,600; `fmt(84)` gives "1:24".

**Browser smoke tests (Playwright):**
- The page loads with no console errors.
- A tile tap rotates the tile (via a debug hook `window.__aglow.state()`).
- Forcing a solve through the debug hook shows the results card and a working share fallback.
- Settings persist across a reload, and an unfinished game resumes.
- `/admin` redirects to login, and the API rejects requests without a session.

**Manual QA matrix:** Chrome, Safari and Firefox on desktop; iOS Safari (current and one previous version); Android Chrome. Check 60fps on a mid-range phone and that the blur fallback looks right on older Safari.

## 10. Out of scope (v1)

- Global leaderboards and accounts.
- A daily seeded puzzle.
- Installable app (PWA) and offline play.
- Keyboard play.
- Counter-clockwise rotation and undo, which would break timing comparability with the original.
- Local MP3 upload.
- Spotify Web Playback SDK.

## 11. Open items for implementation planning

- Source and verify the licences for about 20–30 Piano Carols recordings, and bundle 3–4 as the offline fallback.
- Track lists for Luke's uploads (audio he supplies himself; Spotify is only the list, never the source): Christmas Jazz = https://open.spotify.com/playlist/3rKFTakI4TxtuNLJ1Ruog4, Christmas Classics = https://open.spotify.com/playlist/0N1jXhN0GD3mUEs6prVPVQ.
- Choose the Spotify and Apple preset playlists.
- Design the Open Graph image and share-image composition. The layout is in §6, step 7; the visual will be polished during build.
