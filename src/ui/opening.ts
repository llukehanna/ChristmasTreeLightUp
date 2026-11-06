/**
 * The first-visit opening (ported from the lab's moments-opening). The screen starts dark; the garland flickers on bulb
 * by bulb, the presents catch a glint, the tree's dark silhouette surfaces, the star glints, the room comes up, then
 * AGLOW and the tagline and finally the HUD fade in. The first key or press anywhere skips it. It only draws over the
 * stage: the tree is fetched, revealed and timed exactly as on any other visit.
 */
import type { GarlandGeometry } from '../render/garland';
import { X, Y, type Layout } from '../render/layout';
import { clamp01, smooth } from '../render/paint-util';
import { loadHomeAlone } from '../store/home-alone';
import { loadStarHead } from '../store/star-head';
import { hasPlayed, readJSON, writeJSON } from '../store/storage';

export interface OpeningDeps {
  garland(): GarlandGeometry;
  /** The scene's bulb colours: the garland's palette. */
  bulbs(): readonly string[];
  camera(): { scale: number; tx: number; ty: number };
}

/** The whole opening: the chrome classes come off once their fades have played. */
export const OPENING_MS = 4600;
/** A skip fades the overlay out over this, and ends the opening at SKIP_END_MS. */
const SKIP_FADE_MS = 650;
const SKIP_END_MS = 900;

/** Timeline, seconds from the start. */
const T = {
  garland: 0.42,
  garlandSpan: 0.62,
  glints: 1.0,
  tree: 1.22,
  star: 1.62,
  room: 1.78,
  roomEnd: 2.75,
  mark: 1.95,
  tag: 2.3,
  hud: 2.75,
  done: OPENING_MS / 1000,
};

const KEY = 'aglow.opened';
const CLASSES = ['m-open', 'm-o-mark', 'm-o-tag', 'm-o-hud', 'm-o-fast'];
/** The skip's click follows its pointerup at once; a press that ends in no click is let go after this. */
const TAIL_MS = 400;
/** The longest a skipping press or key is followed (one held past it, or released outside the window, is let go). */
const TAIL_MAX_MS = 3000;

/**
 * First visit: no 'aglow.opened', never played here (no play data, not back from Google: src/store/storage.ts), no
 * reduced motion, and no saved egg world (secret head or Home Alone). Read before this page load writes anything (the
 * App asks first thing).
 */
export function shouldOpen(): boolean {
  if (readJSON(KEY, (v): v is true => v === true) || hasPlayed()) return false;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return !loadStarHead() && !loadHomeAlone();
}

/** This browser has had its opening: it never plays again. */
export function markOpened(): void {
  writeJSON(KEY, true);
}

const ease = (v: number): number => smooth(clamp01(v));
/** The event reaches nothing else; a key with Cmd, Ctrl or Alt (a browser shortcut) keeps its default. */
function swallow(e: Event): void {
  e.stopImmediatePropagation();
  if (!(e instanceof KeyboardEvent && (e.metaKey || e.ctrlKey || e.altKey))) e.preventDefault();
}
/**
 * The rest of a skipping gesture: a press's release and click, a key's keyup. (The press's compatibility mouse events
 * never fire: its pointerdown's default was prevented.)
 */
const TAIL = { pointer: ['pointerup', 'pointercancel', 'click'], key: ['keyup'] } as const;
const bodyClass = (name: string, on: boolean): void => void document.body.classList.toggle(name, on);

export class Opening {
  private playing = false;
  private at = 0;
  private skipAt = -1;
  private seed = 1;
  private timers: number[] = [];
  /** The darkness, a third of the resolution (it's all soft), with holes where the lights have come on. */
  private dark: HTMLCanvasElement | null = null;
  private dctx: CanvasRenderingContext2D | null = null;
  /** Each garland bulb's warm-up this frame, 0..1 (reused). */
  private lit = new Float32Array(0);
  /** toScreen's answer (reused). */
  private readonly pt = { x: 0, y: 0 };
  /** The skipping gesture still being swallowed (its press or key not yet released), and its pointer or key code. */
  private tail: keyof typeof TAIL | null = null;
  private tailPointer = 0;
  private tailCode = '';
  private tailTimer = 0;
  /** Resolves when the room is lit (see roomLit). */
  private lit$: Promise<void> = Promise.resolve();
  private lightRoom: () => void = () => undefined;

  constructor(private readonly d: OpeningDeps) {}

  get on(): boolean {
    return this.playing;
  }

  play(now: number): void {
    if (this.playing) this.end();
    this.release();
    this.playing = true;
    this.at = now;
    this.skipAt = -1;
    this.seed = (Math.random() * 1e9) | 0;
    this.lit$ = new Promise((r) => (this.lightRoom = r));
    for (const c of CLASSES) bodyClass(c, false);
    bodyClass('m-open', true);
    const at = (s: number, fn: () => void) => this.timers.push(window.setTimeout(fn, s * 1000));
    at(T.mark, () => bodyClass('m-o-mark', true));
    at(T.tag, () => bodyClass('m-o-tag', true));
    at(T.hud, () => {
      bodyClass('m-o-hud', true);
      this.lightRoom();
    });
    at(T.done, () => this.end());
    addEventListener('pointerdown', this.onInput, true);
    addEventListener('keydown', this.onInput, true);
    document.addEventListener('visibilitychange', this.onHidden);
  }

  /**
   * The room is lit: the HUD comes in (2.75 s), the opening is skipped, or it ends. The first tree waits for this to
   * start (src/app.ts), so the time spent in the dark is never on its clock. At once when no opening plays.
   */
  roomLit(): Promise<void> {
    return this.lit$;
  }

  /** The overlay fades over 650 ms and the chrome comes in fast; the opening ends at 900 ms. */
  skip(now: number): void {
    if (!this.playing || this.skipAt >= 0) return;
    this.lightRoom();
    this.skipAt = now;
    this.clearTimers();
    for (const c of ['m-o-fast', 'm-o-mark', 'm-o-tag', 'm-o-hud']) bodyClass(c, true);
    this.timers.push(window.setTimeout(() => this.end(), SKIP_END_MS));
  }

  /**
   * The first press or key, anywhere, skips (captured on the window, ahead of everything else). The whole gesture is
   * swallowed: the press, its release and its click, or the key and its keyup, reach nothing else. So a press on the
   * stage turns no tile, one on an unseen HUD button fires nothing, and a key is never N, P, Escape or Tab.
   */
  private readonly onInput = (e: Event): void => {
    if (!this.playing || this.skipAt >= 0) return;
    swallow(e);
    if (e instanceof KeyboardEvent) this.follow('key', 0, e.code);
    else this.follow('pointer', (e as Partial<PointerEvent>).pointerId ?? -1, '');
    this.skip(performance.now());
  };

  /**
   * Swallows the rest of the skipping gesture, until it is over (whether or not the opening still is). Only its own
   * pointer or key: another finger's tap, or another key, goes through as ever.
   */
  private follow(kind: keyof typeof TAIL, pointer: number, code: string): void {
    this.release();
    this.tail = kind;
    this.tailPointer = pointer;
    this.tailCode = code;
    for (const t of TAIL[kind]) addEventListener(t, this.onTail, true);
    this.tailTimer = window.setTimeout(() => this.release(), TAIL_MAX_MS);
  }

  private readonly onTail = (e: Event): void => {
    if (this.tail === 'key') {
      if (!(e instanceof KeyboardEvent) || e.code !== this.tailCode) return;
      swallow(e);
      this.release();
      return;
    }
    // A click with no pointer id (a browser whose click isn't a PointerEvent) can only be the press's own.
    const id = (e as Partial<PointerEvent>).pointerId;
    if (id !== undefined && id !== this.tailPointer) return;
    swallow(e);
    if (e.type === 'click' || e.type === 'pointercancel') this.release();
    else if (e.type === 'pointerup') {
      // A press that ended off its target may bring no click: let go shortly after the release.
      clearTimeout(this.tailTimer);
      this.tailTimer = window.setTimeout(() => this.release(), TAIL_MS);
    }
  };

  private release(): void {
    if (!this.tail) return;
    for (const t of TAIL[this.tail]) removeEventListener(t, this.onTail, true);
    clearTimeout(this.tailTimer);
    this.tail = null;
  }

  /** A hidden tab draws no frames: the opening ends rather than play on unseen (or replay on return). */
  private readonly onHidden = (): void => {
    if (document.hidden) this.end();
  };

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private end(): void {
    if (!this.playing) return;
    this.playing = false;
    this.lightRoom();
    this.clearTimers();
    for (const c of CLASSES) bodyClass(c, false);
    removeEventListener('pointerdown', this.onInput, true);
    removeEventListener('keydown', this.onInput, true);
    document.removeEventListener('visibilitychange', this.onHidden);
  }

  /** Deterministic per-opening noise. */
  private rnd(i: number): number {
    const x = Math.sin((i + 1) * 12.9898 + this.seed * 0.0001) * 43758.5453;
    return x - Math.floor(x);
  }

  /** An old bulb warming up: on, a stutter off, on again (some bulbs stutter twice). 0..1. */
  private flick(t: number, k: number): number {
    if (t < 0) return 0;
    const twice = this.rnd(k * 7) < 0.3;
    const ms = t * 1000;
    if (ms < 45) return ms / 45;
    if (ms < 95) return 0.12;
    if (twice && ms > 150 && ms < 190) return 0.25;
    return Math.min(1, 0.7 + (ms - 95) / 350);
  }

  /** A point of the world (the tree's layout) on screen, under the camera, into `pt`. */
  private toScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.d.camera();
    this.pt.x = x * cam.scale + cam.tx;
    this.pt.y = y * cam.scale + cam.ty;
    return this.pt;
  }

  /** Screen space (the dpr transform), the last thing drawn on the stage while the opening is on. */
  front(c: CanvasRenderingContext2D, L: Layout, now: number): void {
    if (!this.playing) return;
    const t = (now - this.at) / 1000;
    const skip = this.skipAt < 0 ? 1 : 1 - ease((now - this.skipAt) / SKIP_FADE_MS);
    if (skip <= 0) return;
    const { w, h, s } = L;
    const room = 1 - ease((t - T.room) / (T.roomEnd - T.room));
    // The garland's borrowed light lingers past the room, then settles to its real state (the progress it shows).
    const handBack = 1 - ease((t - T.room) / 1.9);
    if (handBack * skip <= 0.002) return;
    const zoom = this.d.camera().scale;

    // 1. The darkness, with holes where the lights have come on.
    const k = 1 / 3;
    const dw = Math.max(2, Math.round(w * k));
    const dh = Math.max(2, Math.round(h * k));
    if (!this.dark) this.dark = document.createElement('canvas');
    const dark = this.dark;
    if (dark.width !== dw || dark.height !== dh || !this.dctx) {
      dark.width = dw;
      dark.height = dh;
      this.dctx = dark.getContext('2d');
    }
    const d = this.dctx;
    if (!d) return;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.globalAlpha = 1;
    d.clearRect(0, 0, dw, dh);
    d.fillStyle = '#030201';
    d.fillRect(0, 0, dw, dh);
    d.setTransform(k, 0, 0, k, 0, 0);
    d.globalCompositeOperation = 'destination-out';
    const geo = this.d.garland();
    const bulbs = geo.bulbs;
    const n = bulbs.length;
    if (this.lit.length !== n) this.lit = new Float32Array(n);
    const on = this.lit;
    for (let i = 0; i < n; i++) {
      const tk = T.garland + (i / Math.max(1, n - 1)) * T.garlandSpan + (this.rnd(i) - 0.5) * 0.08;
      on[i] = this.flick(t - tk, i);
    }
    const sz = geo.size;
    const holeImg = hole();
    for (let i = 0; i < n; i++) {
      if (on[i] <= 0) continue;
      const b = bulbs[i];
      const r = sz * 3.4;
      d.globalAlpha = 0.85 * on[i];
      d.drawImage(holeImg, b.x - r, b.y + sz * 0.55 - r, r * 2, r * 2);
    }
    // The garland's wire catches its own light: a soft band along the top once most bulbs are on.
    const band = ease((t - T.garland - T.garlandSpan * 0.5) / 0.5);
    if (band > 0) {
      d.globalAlpha = 0.35 * band;
      const r = sz * 6;
      for (let x = 0; x <= w; x += r * 0.9) d.drawImage(holeImg, x - r, geo.y0 + geo.sag * 0.5 - r * 0.7, r * 2, r * 1.4);
    }
    // The presents, warming in the glow below the tree.
    const gifts = ease((t - T.glints) / 0.6);
    if (gifts > 0) {
      d.globalAlpha = 0.5 * gifts;
      const r = 3.8 * s * zoom;
      for (let side = -1; side <= 1; side += 2) {
        const p = this.toScreen(X(L, side * 9.6), Y(L, 9.9));
        d.drawImage(holeImg, p.x - r, p.y - r * 0.6, r * 2, r * 1.2);
      }
    }
    // The tree's dark silhouette surfaces: the darkness over it lifts to about half.
    const tree = ease((t - T.tree) / 0.7);
    if (tree > 0) {
      d.globalAlpha = 0.55 * tree;
      const p = this.toScreen(X(L, 0), Y(L, 4.6));
      const rx = 11 * s * zoom;
      const ry = 8.8 * s * zoom;
      d.drawImage(holeImg, p.x - rx, p.y - ry, rx * 2, ry * 2);
    }
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    c.globalAlpha = room * skip;
    if (room > 0.002) c.drawImage(dark, 0, 0, w, h);
    c.globalAlpha = 1;

    // 2. The lights themselves (additive, over the darkness): the garland's bulbs in the scene's colours, handing back
    //    to the garland's real state as the room comes up; the presents' glints; the star's glint.
    c.globalCompositeOperation = 'lighter';
    const palette = this.d.bulbs();
    for (let i = 0; i < n; i++) {
      if (on[i] <= 0) continue;
      const b = bulbs[i];
      const glow = light(palette[i % palette.length]);
      const cx = b.x - Math.sin(b.angle) * sz * 0.55;
      const cy = b.y + Math.cos(b.angle) * sz * 0.6;
      const a = on[i] * handBack * skip;
      c.globalAlpha = 0.9 * a;
      let r = sz * 0.85;
      c.drawImage(glow, cx - r, cy - r, r * 2, r * 2);
      c.globalAlpha = 0.32 * a;
      r = sz * 2.8;
      c.drawImage(glow, cx - r, cy - r, r * 2, r * 2);
    }
    for (let g = 0; g < 6; g++) {
      const tg = t - T.glints - g * 0.11 - this.rnd(g + 40) * 0.12;
      if (tg < 0 || tg > 0.55) continue;
      const a = Math.sin((tg / 0.55) * Math.PI);
      const side = g % 2 ? 1 : -1;
      const p = this.toScreen(X(L, side * (7.8 + this.rnd(g + 20) * 3.4)), Y(L, 9.1 + this.rnd(g + 30) * 1.3));
      drawGlint(c, p.x, p.y, (0.55 + this.rnd(g + 50) * 0.45) * s * zoom, a * skip);
    }
    const ts = t - T.star;
    if (ts > 0 && ts < 0.75) {
      const p = this.toScreen(X(L, 0), Y(L, -1.3));
      const k2 = Math.sin((ts / 0.75) * Math.PI);
      drawGlint(c, p.x, p.y, 1.6 * s * zoom * (0.8 + 0.2 * k2), k2 * 0.9 * skip);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }
}

/* ---------- sprites: painted once, drawn scaled every frame ---------- */

function sprite(px: number, paint: (x: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d');
  if (x) paint(x);
  return c;
}

const lights = new Map<string, HTMLCanvasElement>();
/** A soft coloured light (64 px, once per colour), drawn additively and stretched. */
function light(color: string): HTMLCanvasElement {
  let c = lights.get(color);
  if (!c) {
    c = sprite(64, (x) => {
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, '#fff8ec');
      g.addColorStop(0.12, color);
      g.addColorStop(0.4, color + '66');
      g.addColorStop(1, color + '00');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
    });
    lights.set(color, c);
  }
  return c;
}

let holeSprite: HTMLCanvasElement | null = null;
/** A soft hole for destination-out: opaque centre, feathered edge. */
function hole(): HTMLCanvasElement {
  return (holeSprite ??= sprite(64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.75)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  }));
}

const GLINT_PX = 256;
let glintSprite: HTMLCanvasElement | null = null;
/**
 * A four-point glint (the lab's, painted once at GLINT_PX): two crossed tapered rays reaching the sprite's edge and a
 * soft core half their span, at 0.8 of the rays' strength.
 */
function glint(): HTMLCanvasElement {
  return (glintSprite ??= sprite(GLINT_PX, (x) => {
    const r = GLINT_PX / 2;
    x.translate(r, r);
    x.fillStyle = '#fff4dc';
    for (let q = 0; q < 2; q++) {
      x.beginPath();
      x.moveTo(-r, 0);
      x.quadraticCurveTo(0, -r * 0.07, r, 0);
      x.quadraticCurveTo(0, r * 0.07, -r, 0);
      x.fill();
      x.rotate(Math.PI / 2);
    }
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = 0.8;
    x.drawImage(light('#ffd9a0'), -r * 0.5, -r * 0.5, r, r);
  }));
}

/** The glint at (x, y), `r` from its centre to a ray's tip, at opacity `a` (additive). */
function drawGlint(c: CanvasRenderingContext2D, x: number, y: number, r: number, a: number): void {
  if (a <= 0.01) return;
  c.globalAlpha = a;
  c.drawImage(glint(), x - r, y - r, r * 2, r * 2);
}
