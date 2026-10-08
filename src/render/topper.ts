import { drawStarBody, easeOutBack, foil, ignitePop, starCenter, type StarState } from './effects';
import type { Layout } from './layout';
import type { Scene } from './scenes';

/**
 * The tree's topper: the star, or (the star-head egg, 2026-10-08) Luke's sticker of his head in a Santa hat. Five quick
 * taps on the star (or typing "hohoho") flip one for the other like a coin. The head follows the star's rules: dim
 * before the win, a little brighter as the tree lights, then it ignites with the star's halo and pop, and sways.
 */

export const HEAD_SRC = '/star-head.png';
/** The coin flip: half a turn about the vertical axis. */
export const FLIP_MS = 650;
/** Reduced motion: a crossfade instead of the flip. */
export const FADE_MS = 300;
/** A tap's wobble (taps 1–4). */
export const WOBBLE_MS = 250;
/** The gold flecks and sparkles thrown off at the flip's midpoint. */
export const BURST_MS = 1200;
export const BURST_FLECKS = 40;
const BURST_SPARKLES = 9;
/** The tap target: a circle this many tiles around the star's centre. */
export const STAR_HIT = 0.9;
/** The idle sway after the win, either way. */
export const SWAY_DEG = 4;

/** The head's height in tiles: a touch larger than the star (1.56). The sticker is 240×256. */
const HEAD_H = 1.9;
/** The sticker's top, in tiles from the star's centre: the hat sits where the star's top point was. */
const HEAD_TOP = -0.82;
/** The chin, in tiles below the star's centre (about the tree's tip): the head sways and wobbles about it. */
const HEAD_PIVOT = 0.76;
/** The bottom fraction of the sticker that fades out into the tree's tip. */
const FEATHER = 0.16;
/** How far the flip tosses the topper up (tiles) and toward the viewer (scale). */
const TOSS = 0.32;
const GROW = 0.12;
/** The flip shows the face's edge once the face is narrower than this. */
const RIM_FROM = 0.3;
/** The landing after a flip: a softer wobble than a tap's. */
const LAND = 0.55;
const TAP_FLASH_MS = 420;
/** The lit head's aura on the glow layer, at full light. */
const AURA = 0.85;
/** Unlit: the sticker as grey-gold glass, darker and nearly colourless (night scenes; frost is a daylight scene). */
const DIM = { night: { sat: 0.22, bright: 0.4 }, day: { sat: 0.3, bright: 0.62 } } as const;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface FlipPose {
  /** |cos(π·e)|: the face's width as it turns. */
  scaleX: number;
  /** Past the midpoint: the new face shows. */
  newFace: boolean;
  /** |sin(π·e)|: how edge-on it is (1 at the midpoint). */
  edge: number;
  /** 0 → 1 → 0: the toss up and toward the viewer. */
  toss: number;
}

/** The coin flip `t` ms in (eased: slow off the mark, fastest edge-on), or null outside it. */
export function flipPose(t: number): FlipPose | null {
  if (!(t >= 0 && t < FLIP_MS)) return null;
  const k = t / FLIP_MS;
  const e = easeInOutCubic(k);
  return { scaleX: Math.abs(Math.cos(Math.PI * e)), newFace: e >= 0.5, edge: Math.abs(Math.sin(Math.PI * e)), toss: Math.sin(Math.PI * k) };
}

/** Reduced motion: the new face's opacity `t` ms into the crossfade, or null outside it. */
export function crossfade(t: number): number | null {
  return t >= 0 && t < FADE_MS ? t / FADE_MS : null;
}

/** Taps 1–4 nudge harder each time, building to the fifth. */
export const tapStrength = (n: number): number => 0.55 + 0.15 * (Math.min(4, Math.max(1, n)) - 1);

const REST = { angle: 0, scale: 1 } as const;

/** A tap's wobble `t` ms after it: a damped rotation spring (one and a half swings) with a small boop of scale. */
export function wobble(t: number, strength: number): { angle: number; scale: number } {
  if (!(t >= 0 && t < WOBBLE_MS)) return REST;
  const k = t / WOBBLE_MS;
  const env = (1 - k) ** 2;
  return { angle: strength * 0.21 * env * Math.sin(3 * Math.PI * k), scale: 1 + strength * 0.09 * (1 - k) * Math.sin(Math.PI * Math.min(1, k * 2)) };
}

const STILL = { angle: 0, bob: 0 } as const;

/**
 * After the win the head sways (±4°, about the chin) and bobs (±2% of its height), slowly and out of step, easing in
 * once the ignite's pop has settled. Never under reduced motion.
 */
export function idleSway(now: number, winAt: number | null, reduced: boolean): { angle: number; bob: number } {
  if (winAt === null || reduced) return STILL;
  const t = now - winAt - 900;
  if (t <= 0) return STILL;
  const env = smooth(clamp01(t / 1600));
  return { angle: env * ((SWAY_DEG * Math.PI) / 180) * Math.sin((TAU * t) / 3800), bob: env * 0.02 * Math.sin((TAU * t) / 2700 + 1.1) };
}

/**
 * How lit the head is, 0..1, mirroring starState: before the win a little light as the tree fills (at most 0.35); the
 * win ignites it with the star. A tap or a flip (`flash` 0..1) lights it briefly.
 */
export function headLight(st: StarState, won: boolean, litFrac: number, flash: number): number {
  const base = won ? st.on : 0.35 * litFrac ** 5;
  return Math.min(1, base + (1 - base) * 0.55 * flash);
}

/** A point in world CSS px is on the star (the tap target), never on a tile (the star sits above row 0). */
export function onStar(L: Layout, x: number, y: number): boolean {
  const [cx, cy] = starCenter(L);
  return Math.hypot(x - cx, y - cy) <= STAR_HIT * L.s;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D is unavailable');
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  return [c, x];
}

/** A cached sticker's height for `size` device px: in steps of 8 (a pinch-zoom rebuilds it a few times, not every frame), never above the file's own. */
const cacheHeight = (img: HTMLImageElement, size: number): number => Math.max(16, Math.min(img.naturalHeight, Math.ceil(size / 8) * 8));
const cacheWidth = (img: HTMLImageElement, h: number): number => Math.max(1, Math.round((h * img.naturalWidth) / img.naturalHeight));

/** The sticker at `w`×`h` device px, halving first so a big step down stays smooth (Safari's smoothing is plain bilinear). */
function resample(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  let src: CanvasImageSource = img;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  while (sw >= w * 2 && sh >= h * 2) {
    const [c, x] = canvas(Math.ceil(sw / 2), Math.ceil(sh / 2));
    x.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const [out, x] = canvas(w, h);
  x.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  // The photo is cut straight across at the neck: fade its last stretch, so the head rises out of the tree's tip
  // instead of ending in a hard line across the branches.
  x.globalCompositeOperation = 'destination-in';
  const fade = x.createLinearGradient(0, h * (1 - FEATHER), 0, h);
  fade.addColorStop(0, '#000');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = fade;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-over';
  return out;
}

/** The unlit sticker: desaturated and darkened per pixel (ctx.filter would do it, but Safari ignores it). */
function dimmed(lit: HTMLCanvasElement, day: boolean): HTMLCanvasElement {
  const [c, x] = canvas(lit.width, lit.height);
  x.drawImage(lit, 0, 0);
  const { sat, bright } = day ? DIM.day : DIM.night;
  try {
    const im = x.getImageData(0, 0, c.width, c.height);
    const p = im.data;
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      // A faint warm cast, like the unlit star's glass.
      p[i] = (l + (p[i] - l) * sat) * bright * 1.04;
      p[i + 1] = (l + (p[i + 1] - l) * sat) * bright;
      p[i + 2] = (l + (p[i + 2] - l) * sat) * bright * 0.9;
    }
    x.putImageData(im, 0, 0);
  } catch {
    // Pixels unreadable: darken without desaturating.
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(14,11,9,${1 - bright})`;
    x.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

interface Mote {
  /** Start, in tiles from the star's centre; velocity in tiles/s. */
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  /** Half-length (fleck) or radius (sparkle), in tiles. */
  size: number;
  spin: number;
  tumble: number;
  ph: number;
  tone: number;
  /** Fraction of BURST_MS this one lives. */
  life: number;
  sparkle: boolean;
}

/** Burst physics: linear drag and a light gravity, so flecks fly out, slow, and drift down onto the tree's top. */
const DRAG = 2.4;
const GRAVITY = 5;

export class Topper {
  /** The face at rest (where a flip lands). */
  private head = false;
  /** The face a flip (or crossfade) started from. */
  private from = false;
  private flipAt = Number.NEGATIVE_INFINITY;
  private tapAt = Number.NEGATIVE_INFINITY;
  private tapPower = 0;
  private burstAt = Number.NEGATIVE_INFINITY;
  private readonly motes: Mote[] = Array.from({ length: BURST_FLECKS + BURST_SPARKLES }, (_, k) => ({
    x0: 0, y0: 0, vx: 0, vy: 0, size: 0, spin: 0, tumble: 0, ph: 0, tone: 0, life: 1, sparkle: k >= BURST_FLECKS,
  }));
  private img: HTMLImageElement | null = null;
  private loading: Promise<boolean> | null = null;
  private faceKey = '';
  private lit: HTMLCanvasElement | null = null;
  private dim: HTMLCanvasElement | null = null;
  private auraKey = '';
  private auraCanvas: HTMLCanvasElement | null = null;

  /** The face at rest: true once the head is (or is landing) on top. */
  get isHead(): boolean {
    return this.head;
  }

  get ready(): boolean {
    return this.img !== null;
  }

  /** A flip or crossfade is under way. */
  busy(now: number): boolean {
    return now - this.flipAt < FLIP_MS;
  }

  /** Loads the sticker once, lazily (only when the egg is on, or taps start toward it). Resolves false if it can't. */
  load(): Promise<boolean> {
    if (!this.loading) {
      const img = new Image();
      img.decoding = 'async';
      this.loading = new Promise<boolean>((resolve) => {
        img.onload = () => {
          this.img = img;
          this.faceKey = '';
          resolve(true);
        };
        img.onerror = () => {
          this.loading = null; // a later toggle tries again
          resolve(false);
        };
      });
      img.src = HEAD_SRC;
    }
    return this.loading;
  }

  /** Puts a face on top at once (the stored preference at start). */
  set(head: boolean): void {
    this.head = this.from = head;
    this.flipAt = Number.NEGATIVE_INFINITY;
  }

  /** Flips to `head` from whatever shows now, throwing off a burst of gold at the midpoint. */
  flip(head: boolean, now: number): void {
    const t = now - this.flipAt;
    const pose = flipPose(t);
    this.from = pose ? (pose.newFace ? this.head : this.from) : this.head;
    this.head = head;
    this.flipAt = now;
    this.spawnBurst(now + FLIP_MS / 2);
  }

  /** Taps 1–4 (`n`): a wobble, a little harder each time, and a brief glint. */
  tap(now: number, n: number): void {
    this.tapAt = now;
    this.tapPower = tapStrength(n);
  }

  /** 0..1: how brightly a tap or a flip lights the topper just now. */
  flash(now: number): number {
    const tt = now - this.tapAt;
    const tap = tt >= 0 && tt < TAP_FLASH_MS ? this.tapPower * (1 - tt / TAP_FLASH_MS) ** 2 : 0;
    const tf = now - this.flipAt;
    const half = FLIP_MS / 2;
    // Brightens into the flip, peaks edge-on, then settles back over half a second after it lands.
    const flip = tf < 0 || tf > FLIP_MS + 500 ? 0 : tf < half ? smooth(tf / half) : (1 - (tf - half) / (half + 500)) ** 2;
    return Math.max(tap * 0.75, flip);
  }

  /** Extra halo (added to the star's glow) while a tap or a flip lights the topper. */
  glowKick(now: number): number {
    return 0.55 * this.flash(now);
  }

  /** Where the topper is this frame: its centre (tossed by a flip), its scale (the win's pop, a tap's boop, the toss), the wobble. */
  private place(L: Layout, st: StarState, won: boolean, now: number, reduced: boolean) {
    const tf = now - this.flipAt;
    const flip = reduced ? null : flipPose(tf);
    const fade = reduced ? crossfade(tf) : null;
    let angle = 0;
    let boop = 1;
    if (!reduced) {
      const w = wobble(now - this.tapAt, this.tapPower);
      const land = wobble(tf - FLIP_MS, LAND);
      angle = w.angle + land.angle;
      boop = w.scale * land.scale;
    }
    const [cx, cy] = starCenter(L);
    return {
      cx,
      cy: cy - (flip ? TOSS * L.s * flip.toss : 0),
      k: ignitePop(st, won) * boop * (flip ? 1 + GROW * flip.toss : 1),
      angle,
      flip,
      fade,
      /** The face showing (outside a crossfade): the old one until the flip's midpoint. */
      head: flip && !flip.newFace ? this.from : this.head,
    };
  }

  /**
   * The topper in world space (pass 2, after the bloom, so the star's halo sits behind it). `px` is device px per
   * world CSS px (dpr × camera zoom): the sticker is cached at the size it is drawn, per size and scene light.
   */
  draw(c: CanvasRenderingContext2D, L: Layout, sc: Scene, st: StarState, won: boolean, litFrac: number, now: number, winAt: number | null, reduced: boolean, px: number): void {
    const p = this.place(L, st, won, now, reduced);
    const flash = this.flash(now);
    const light = headLight(st, won, litFrac, flash);
    c.save();
    c.translate(p.cx, p.cy);
    c.scale(p.k, p.k);
    if (p.fade !== null) {
      this.face(c, L, sc, st, light, flash, now, winAt, reduced, px, this.from, 1 - p.fade, 0, 1);
      this.face(c, L, sc, st, light, flash, now, winAt, reduced, px, this.head, p.fade, 0, 1);
    } else {
      this.face(c, L, sc, st, light, flash, now, winAt, reduced, px, p.head, 1, p.angle, p.flip ? p.flip.scaleX : 1);
      if (p.flip && p.flip.scaleX < RIM_FROM) this.rim(c, L.s, p.head && this.img !== null, p.flip.scaleX);
    }
    c.restore();
    // From where the topper was at the flip's midpoint (tossed up), not following it back down.
    if (!reduced) this.drawBurst(c, L.s, p.cx, starCenter(L)[1] - TOSS * L.s, now);
  }

  /**
   * The head's aura on the glow layer (pass 1): its silhouette in the scene's glow colour, which the bloom softens into
   * a halo hugging the sticker, as bright as the head is lit. The star needs none: its own glow is drawStarGlow's.
   */
  drawGlow(g: CanvasRenderingContext2D, L: Layout, sc: Scene, st: StarState, won: boolean, litFrac: number, now: number, winAt: number | null, reduced: boolean, px: number): void {
    if (!this.img || (!this.head && !this.from)) return;
    const p = this.place(L, st, won, now, reduced);
    let alpha = p.fade !== null ? (this.head ? p.fade : 0) + (this.from ? 1 - p.fade : 0) : p.head ? 1 : 0;
    alpha *= AURA * headLight(st, won, litFrac, this.flash(now));
    const aura = alpha > 0.01 ? this.aura(HEAD_H * L.s * px, sc) : null;
    if (!aura) return;
    g.save();
    g.translate(p.cx, p.cy);
    g.scale(p.k, p.k);
    const top = this.orient(g, L.s, p.fade !== null ? 0 : p.angle, p.flip ? p.flip.scaleX : 1, now, winAt, reduced);
    const h = HEAD_H * L.s;
    const w = (h * aura.width) / aura.height;
    g.globalAlpha = alpha;
    g.drawImage(aura, -w / 2, top, w, h);
    g.restore();
  }

  /** Turns `c` about the chin (the wobble and the idle sway) and squeezes it for the flip; returns the sticker's top, bobbing. */
  private orient(c: CanvasRenderingContext2D, s: number, angle: number, sx: number, now: number, winAt: number | null, reduced: boolean): number {
    const sway = idleSway(now, winAt, reduced);
    const pivot = HEAD_PIVOT * s;
    c.translate(0, pivot);
    c.rotate(angle + sway.angle);
    c.translate(0, -pivot);
    c.scale(sx, 1);
    return HEAD_TOP * s + sway.bob * HEAD_H * s;
  }

  /** One face at the origin (the star's centre), `sx` its width as it turns; `light` is the head's (headLight). */
  private face(
    c: CanvasRenderingContext2D, L: Layout, sc: Scene, st: StarState, light: number, flash: number, now: number,
    winAt: number | null, reduced: boolean, px: number, head: boolean, alpha: number, angle: number, sx: number,
  ): void {
    if (alpha <= 0) return;
    const s = L.s;
    const faces = head ? this.faces(HEAD_H * s * px, sc.light === 'day') : null;
    // The stored head at start, still decoding: nothing for those few frames, rather than a star that pops into a head.
    if (head && !faces && this.loading) return;
    c.save();
    c.globalAlpha = alpha;
    if (!faces) {
      // The star (or the head's stand-in until the sticker has loaded).
      c.rotate(angle);
      c.scale(sx, 1);
      drawStarBody(c, s, sc, Math.max(st.on, 0.85 * flash));
      c.restore();
      return;
    }
    const top = this.orient(c, s, angle, sx, now, winAt, reduced);
    const h = HEAD_H * s;
    const w = (h * faces.lit.width) / faces.lit.height;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    if (light < 1) c.drawImage(faces.dim, -w / 2, top, w, h);
    if (light > 0) {
      c.globalAlpha = alpha * light;
      c.drawImage(faces.lit, -w / 2, top, w, h);
    }
    c.restore();
  }

  /** The edge, seen only as the face turns nearly edge-on (`sx` its width): gold for the star, the sticker's white border for the head. */
  private rim(c: CanvasRenderingContext2D, s: number, head: boolean, sx: number): void {
    const half = head ? HEAD_H * s * 0.4 : s * 0.66;
    const mid = head ? (HEAD_TOP + HEAD_H / 2) * s : 0;
    const k = 1 - sx / RIM_FROM;
    const w = s * 0.09 * (0.5 + 0.5 * k);
    c.save();
    c.globalAlpha = smooth(k);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, mid - half);
    c.lineTo(0, mid + half);
    c.strokeStyle = head ? '#cfc6b8' : '#b07c26';
    c.lineWidth = w;
    c.stroke();
    c.strokeStyle = head ? '#fffaf0' : '#ffe7a6';
    c.lineWidth = w * 0.42;
    c.stroke();
    c.restore();
  }

  /** The sticker lit and dimmed at `size` device px tall (capped at its own resolution), rebuilt only when that changes. */
  private faces(size: number, day: boolean): { lit: HTMLCanvasElement; dim: HTMLCanvasElement } | null {
    const img = this.img;
    if (!img || !img.naturalHeight) return null;
    const h = cacheHeight(img, size);
    const key = `${h}:${day}`;
    if (key !== this.faceKey || !this.lit || !this.dim) {
      if (this.lit) this.lit.width = this.lit.height = 0;
      if (this.dim) this.dim.width = this.dim.height = 0;
      this.lit = resample(img, cacheWidth(img, h), h);
      this.dim = dimmed(this.lit, day);
      this.faceKey = key;
    }
    return { lit: this.lit, dim: this.dim };
  }

  /** The sticker's silhouette in the scene's glow colour, at the glow layer's size (its own cache: that layer is half-res). */
  private aura(size: number, sc: Scene): HTMLCanvasElement | null {
    const img = this.img;
    if (!img || !img.naturalHeight) return null;
    const h = cacheHeight(img, size);
    const key = `${h}:${sc.glow}`;
    if (key !== this.auraKey || !this.auraCanvas) {
      if (this.auraCanvas) this.auraCanvas.width = this.auraCanvas.height = 0;
      const c = resample(img, cacheWidth(img, h), h);
      const x = c.getContext('2d');
      if (x) {
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = sc.glow;
        x.fillRect(0, 0, c.width, c.height);
      }
      this.auraCanvas = c;
      this.auraKey = key;
    }
    return this.auraCanvas;
  }

  private spawnBurst(at: number): void {
    this.burstAt = at;
    for (const m of this.motes) {
      // Thrown outward from a ring just inside the topper's outline (so none crosses the face), mostly upward and
      // sideways, like a pinch of glitter.
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      const speed = m.sparkle ? 1.4 + Math.random() * 2.2 : 2.2 + Math.random() * 4;
      const ring = 0.55 + Math.random() * 0.2;
      m.x0 = Math.cos(a) * ring;
      m.y0 = -0.15 + Math.sin(a) * ring;
      m.vx = Math.cos(a) * speed;
      m.vy = Math.sin(a) * speed - 0.8;
      m.size = m.sparkle ? 0.13 + Math.random() * 0.13 : 0.045 + Math.random() * 0.04;
      m.spin = (Math.random() - 0.5) * 9;
      m.tumble = 6 + Math.random() * 9;
      m.ph = Math.random() * TAU;
      m.tone = Math.random();
      m.life = 0.65 + Math.random() * 0.35;
    }
  }

  /** Positioned from elapsed time (frame drops don't matter), in world space so it rides the camera. */
  private drawBurst(c: CanvasRenderingContext2D, s: number, cx: number, cy: number, now: number): void {
    const t = now - this.burstAt;
    if (!(t >= 0 && t < BURST_MS)) return;
    const T = t / 1000;
    const d = (1 - Math.exp(-DRAG * T)) / DRAG;
    const fall = (GRAVITY / DRAG) * (T - d);
    for (const m of this.motes) {
      const life = t / (BURST_MS * m.life);
      if (life >= 1) continue;
      const x = cx + (m.x0 + m.vx * d) * s;
      const y = cy + (m.y0 + m.vy * d + fall) * s;
      const a = Math.min(1, life * 16) * Math.min(1, (1 - life) / 0.5);
      c.save();
      c.translate(x, y);
      if (m.sparkle) {
        // A four-point twinkle, additive, pulsing as it fades.
        const r = m.size * s * (0.55 + 0.45 * Math.abs(Math.sin(T * m.tumble + m.ph))) * (0.6 + 0.4 * easeOutBack(Math.min(1, life * 5)));
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = a * 0.9;
        c.rotate(m.ph * 0.1);
        c.fillStyle = '#fff3d2';
        c.beginPath();
        c.moveTo(0, -r);
        c.quadraticCurveTo(0, 0, r * 0.62, 0);
        c.quadraticCurveTo(0, 0, 0, r);
        c.quadraticCurveTo(0, 0, -r * 0.62, 0);
        c.quadraticCurveTo(0, 0, 0, -r);
        c.fill();
      } else {
        // A tumbling foil fleck, as in the win confetti: foreshortened by its flip, brightest face-on.
        const face = Math.abs(Math.cos(m.tumble * T + m.ph));
        const size = m.size * s;
        c.rotate(m.spin * T + m.ph);
        c.scale(1, Math.max(0.12, face));
        c.globalAlpha = a;
        c.fillStyle = foil(face, m.tone);
        c.fillRect(-size, -size * 0.42, size * 2, size * 0.84);
        if (face > 0.9) {
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = a * (face - 0.9) * 8;
          c.fillStyle = '#fff6e0';
          c.fillRect(-size, -size * 0.42, size * 2, size * 0.84);
        }
      }
      c.restore();
    }
  }
}
