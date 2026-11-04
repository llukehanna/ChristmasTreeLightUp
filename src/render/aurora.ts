import { mulberry32, type Rng } from '../core/rng';
import { Y, type Layout } from './layout';

/**
 * Secret mode's sky (spec 2026-10-08 secret mode §2): three aurora curtains baked once per layout at a quarter of the
 * resolution (the upscale softens them for free), drawn each frame with one drawImage apiece, drifting, shimmering and
 * breathing slowly; and the clip and seam the sweep (src/render/sky-sweep.ts) brings them in and out by. An egg: loaded
 * on first use (src/eggs/load.ts).
 */

const TAU = Math.PI * 2;

/** Sprite px per device px. */
export const RES = 0.25;
/** A sprite spans this many viewport widths, so its drift never shows an end. */
export const SPAN = 1.6;
/** The furthest a curtain drifts either way, in viewport widths. */
export const DRIFT = 0.12;

export { FADE_MS, SWEEP_FADE_MS, SWEEP_MS, SkySweep, fadeFrame, sweepFrame, type SceneChange, type SweepFrame, type SweepRun } from './sky-sweep';

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
  // Teal's hem sits above green's (0.42 vs 0.48 hz): a second, farther curtain, not one flat shelf with it.
  { rgb: '70,214,236', top: 0.08, height: 0.34, waves: 2.6, alpha: 0.4, phase: 2.1, driftMs: 53_000, shimmerMs: 7_100, breathMs: 12_100 },
  { rgb: '170,120,255', top: 0, height: 0.3, waves: 1.2, alpha: 0.36, phase: 4.2, driftMs: 67_000, shimmerMs: 8_900, breathMs: 15_300 },
];

/** Curtains per quality tier: 3, then 2 (green, teal), then 1 (green). */
export const ribbonCount = (tier: number): number => (tier >= 3 ? 1 : tier >= 2 ? 2 : 3);

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
  // A crisp hem: the lit fold's lower edge, not a smear.
  g.addColorStop(0.9, `rgba(${R.rgb},1)`);
  g.addColorStop(0.97, `rgba(${R.rgb},0)`);
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
  /** The sweep's seam: a SEAM_W × SEAM_H glow strip, made on first use (null: no 2D context). */
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

  /**
   * Clips to the sky the aurora covers: above `y` (CSS px), along a billowing edge that is the seam's own core (so
   * the hem hides the backdrop step everywhere), or a straight one while the edge is dark (`k` 0: the reduced-motion
   * crossfade, or before the sweep starts). Path ops only, nothing allocated.
   */
  clipSky(c: CanvasRenderingContext2D, L: Layout, y: number, k: number, now: number): void {
    c.beginPath();
    if (k <= 0) c.rect(0, 0, L.w, y);
    else {
      const { amp, x0, span } = seamFit(L, now);
      c.moveTo(0, -amp - 1);
      c.lineTo(L.w, -amp - 1);
      for (let i = SEAM_EDGE_POINTS; i >= 0; i--) {
        const x = (i / SEAM_EDGE_POINTS) * L.w;
        c.lineTo(x, y + amp * seamWave((x - x0) / span));
      }
      c.closePath();
    }
    c.clip();
  }

  /**
   * The glowing hem along the sweep's edge, `y` in CSS px, `k` its strength 0..1: the strip's hot core rides the
   * clip's billowing edge (hiding the backdrop step), its rays trail up into the aurora, almost nothing spills below.
   */
  drawSeam(c: CanvasRenderingContext2D, L: Layout, y: number, k: number, now = 0): void {
    if (k <= 0) return;
    if (this.seam === undefined) this.seam = makeSeam();
    if (!this.seam) return;
    const op = c.globalCompositeOperation;
    const a0 = c.globalAlpha;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = k;
    const { hh, x0, span } = seamFit(L, now);
    c.drawImage(this.seam, x0, y - (SEAM_CORE_ROW / SEAM_P) * hh, span, (SEAM_H / SEAM_P) * hh);
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

/**
 * The seam strip, SEAM_W × SEAM_H px. Its glow profile is SEAM_P rows tall (that is `hh` on screen) with the hot core
 * at SEAM_CORE of it; the core rides SEAM_CORE_ROW ± SEAM_AMP rows along `seamWave`. The strip spans SEAM_SPAN
 * viewport widths and sways sideways, so the billow travels along the edge.
 */
export const SEAM_W = 512;
export const SEAM_H = 128;
export const SEAM_P = 80;
export const SEAM_CORE = 0.68;
export const SEAM_CORE_ROW = 84;
export const SEAM_AMP = 28;
export const SEAM_SPAN = 1.5;
/** Points along the clip's billowing edge. */
const SEAM_EDGE_POINTS = 32;
/** The sway: the strip's left end runs SEAM_X0 ± SEAM_SWAY viewport widths over SEAM_SWAY_MS. */
const SEAM_X0 = -0.25;
const SEAM_SWAY = 0.18;
const SEAM_SWAY_MS = 3600;

/** The edge's billow at `u` (0..1 along the strip), −1..1: two incommensurate folds. */
export const seamWave = (u: number): number => 0.65 * Math.sin(TAU * u * 3.1 + 0.4) + 0.35 * Math.sin(TAU * u * 7.3 + 2.2);

/** The seam on screen: glow height `hh`, billow amplitude `amp` (CSS px), the strip's left end `x0` and width `span`. */
function seamFit(L: Layout, now: number): { hh: number; amp: number; x0: number; span: number } {
  const hh = Math.min(1.6 * L.s, 0.05 * L.h);
  const x0 = (SEAM_X0 + SEAM_SWAY * Math.sin((TAU * now) / SEAM_SWAY_MS)) * L.w;
  return { hh, amp: (SEAM_AMP / SEAM_P) * hh, x0, span: SEAM_SPAN * L.w };
}

/**
 * The sweep's hem, baked once: a soft wash trailing up, a thin near-white core, nothing much below, the core riding
 * `seamWave`. Each column's strength and reach vary (seeded noise), so the edge breaks into rays like the curtains'
 * own hem instead of a ruler line.
 */
function makeSeam(): HTMLCanvasElement | null {
  const cv = document.createElement('canvas');
  cv.width = SEAM_W;
  cv.height = SEAM_H;
  const c = cv.getContext('2d');
  if (!c) return null;
  const top = SEAM_CORE_ROW - SEAM_CORE * SEAM_P;
  const g = c.createLinearGradient(0, top, 0, top + SEAM_P);
  g.addColorStop(0, 'rgba(120,255,200,0)');
  g.addColorStop(0.45, 'rgba(120,255,200,.18)');
  g.addColorStop(SEAM_CORE, 'rgba(210,255,240,.9)');
  g.addColorStop(0.74, 'rgba(120,255,200,.25)');
  g.addColorStop(0.82, 'rgba(120,255,200,0)');
  c.fillStyle = g;
  const r = mulberry32(41);
  const coarse = rayNoise(SEAM_W, 16, r);
  const fine = rayNoise(SEAM_W, 5, r);
  const reach = rayNoise(SEAM_W, 7, r);
  for (let x = 0; x < SEAM_W; x++) {
    const u = (x + 0.5) / SEAM_W;
    c.globalAlpha = (0.5 + 0.5 * (0.6 * coarse[x] + 0.4 * fine[x])) * Math.min(1, u / 0.03, (1 - u) / 0.03);
    // The wash above the core reaches 55–100 % of the way up, scaled about the core, which rides the billow.
    const k = 0.55 + 0.45 * reach[x];
    const core = SEAM_CORE_ROW + SEAM_AMP * seamWave(u);
    c.setTransform(1, 0, 0, k, 0, core - k * SEAM_CORE_ROW);
    c.fillRect(x, top, 1, SEAM_P);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  return cv;
}
