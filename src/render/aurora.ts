import { mulberry32, type Rng } from '../core/rng';
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
  out.edge = k < 1 ? Math.sin(Math.PI * k) : 0; // sin(π) is 1e-16, not 0
  out.done = t >= SWEEP_MS;
  return out;
}

/** The most a fold lifts a column, as a fraction of the sprite's height. */
const LIFT = 0.22;
/** Ray striations: a coarse and a fine octave, their spacing in CSS px (never under 2.5 sprite px). */
const RAY_COARSE_CSS = 46;
const RAY_FINE_CSS = 13;

/** Smooth value noise along a row of `n` columns, 0..1, a lattice point every `period` columns. Bake time only. */
export function rayNoise(n: number, period: number, r: Rng): Float32Array {
  const knots = Math.ceil(n / period) + 2;
  const k = new Float32Array(knots);
  for (let i = 0; i < knots; i++) k[i] = r();
  const out = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const p = x / period;
    const i = Math.floor(p);
    const f = (1 - Math.cos(Math.PI * (p - i))) / 2;
    out[x] = k[i] + (k[i + 1] - k[i]) * f;
  }
  return out;
}

/**
 * One curtain into a sprite: rays of light over a bright, wavy lower hem, fading up into the sky and out at both ends.
 * The broad folds and rays are spec §2.2's; seeded noise adds fine, uneven striations and ragged ray tops (a real
 * curtain's look), and the gradient leaves headroom for the folds' lift so no column is cut off at the sprite's top.
 */
function paintCurtain(c: CanvasRenderingContext2D, w: number, h: number, R: Ribbon, cssPerPx: number, seed: number): void {
  const g = c.createLinearGradient(0, LIFT * h, 0, h);
  g.addColorStop(0, `rgba(${R.rgb},0)`);
  g.addColorStop(0.55, `rgba(${R.rgb},0.28)`);
  g.addColorStop(0.86, `rgba(${R.rgb},1)`);
  g.addColorStop(1, `rgba(${R.rgb},0)`);
  c.fillStyle = g;
  const r = mulberry32(seed);
  const coarse = rayNoise(w, Math.max(2.5, RAY_COARSE_CSS / cssPerPx), r);
  const fine = rayNoise(w, Math.max(2.5, RAY_FINE_CSS / cssPerPx), r);
  const reach = rayNoise(w, Math.max(2.5, RAY_FINE_CSS / cssPerPx), r);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    const lift = LIFT * (0.5 + 0.5 * Math.sin(TAU * u * R.waves + R.phase));
    const rays = 0.45 + 0.55 * Math.sin(TAU * u * R.waves * 4.3 + 2 * R.phase) ** 2;
    const striae = 0.3 + 0.7 * (0.55 * coarse[x] + 0.45 * fine[x]) ** 1.4;
    c.globalAlpha = Math.min(1, 1.25 * rays * striae) * Math.min(1, u / 0.12, (1 - u) / 0.12);
    // A ray reaches 65–100 % of the way up from the hem; the fold lifts the whole column.
    const k = 0.65 + 0.35 * reach[x];
    c.setTransform(1, 0, 0, k, 0, h * (1 - k) - lift * h);
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
    for (const [k, R] of RIBBONS.entries()) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(8, Math.ceil(SPAN * L.w * L.dpr * RES));
      cv.height = Math.max(8, Math.ceil(hz * R.height * L.dpr * RES));
      const c = cv.getContext('2d');
      if (!c) break;
      paintCurtain(c, cv.width, cv.height, R, 1 / (L.dpr * RES), 29 + k);
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
