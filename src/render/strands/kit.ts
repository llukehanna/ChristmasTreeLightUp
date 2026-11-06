/**
 * The strands' shared kit (season two, C3; ported from the lab's strands-kit): a sprite cache (offscreen canvases at
 * device resolution), path sampling along a tile's wire primitives, and the painters for twisted cord and fine chain.
 * Everything heavy is painted once into a sprite and drawn per frame with a single drawImage.
 */
import { hexRgb } from '../color';
import { pointAt, type Prim } from '../geometry';

export const TAU = Math.PI * 2;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Device pixels per local unit for the context's current transform (camera, dpr, settle scale). */
export function devScale(c: CanvasRenderingContext2D): number {
  const m = c.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

/** The rotation already applied to `c` (a tile turning), so upright things can undo it. */
export function devAngle(c: CanvasRenderingContext2D): number {
  const m = c.getTransform();
  return Math.atan2(m.b, m.a);
}

/** Resolution buckets ~9% apart, so a settle bounce or a pinch does not rebuild sprites every frame. */
export function bucket(px: number): number {
  return Math.max(8, Math.round(Math.pow(2, Math.round(Math.log2(px) * 8) / 8)));
}

export interface Sprite {
  cv: HTMLCanvasElement;
  /** Placement in local units (tile px), relative to the origin it was painted around. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const cache = new Map<string, Sprite>();

/**
 * A cached sprite covering local box [x0, y0, w, h] (in units of `unit`, usually the tile size), painted at `ppu`
 * device px per unit. `paint` draws in the same local units with the origin where the caller's origin is.
 */
export function sprite(key: string, unit: number, ppu: number, box: readonly [number, number, number, number], paint: (c: CanvasRenderingContext2D, u: number) => void): Sprite {
  const res = bucket(unit * ppu);
  const full = `${key}|${res}`;
  const hit = cache.get(full);
  if (hit) return { ...hit, x: box[0] * unit, y: box[1] * unit, w: box[2] * unit, h: box[3] * unit };
  if (cache.size > 900) cache.clear();
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(box[2] * res));
  cv.height = Math.max(1, Math.ceil(box[3] * res));
  const c = cv.getContext('2d')!;
  // Paint in units of the tile (u = 1 tile = res px), origin offset into the box.
  c.setTransform(res, 0, 0, res, -box[0] * res, -box[1] * res);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  paint(c, 1 / res);
  const sp = { cv, x: 0, y: 0, w: 0, h: 0 };
  cache.set(full, sp);
  return { cv, x: box[0] * unit, y: box[1] * unit, w: box[2] * unit, h: box[3] * unit };
}

export function blit(c: CanvasRenderingContext2D, sp: Sprite): void {
  c.drawImage(sp.cv, sp.x, sp.y, sp.w, sp.h);
}

/* ---------- colour ---------- */

export type RGB = readonly [number, number, number];
export const rgb = (hex: string): RGB => hexRgb(hex);
export const css = (v: RGB, a = 1): string => `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${a})`;
export const lerp3 = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const mul3 = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
export const WHITE: RGB = [255, 255, 255];
/** Relative luminance-ish (0..1), for keeping pale colours from washing out. */
export const luma = (v: RGB): number => (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
/** Saturation scaled by `k` about the colour's grey (clamped to 0..255). */
export function sat(v: RGB, k: number): RGB {
  const g = luma(v) * 255;
  const f = (x: number) => Math.max(0, Math.min(255, g + (x - g) * k));
  return [f(v[0]), f(v[1]), f(v[2])];
}

/* ---------- path sampling ---------- */

export interface Sample {
  x: number;
  y: number;
  /** Unit tangent. */
  tx: number;
  ty: number;
  /** Distance (tile units) from the prim's edge end, so neighbouring tiles meet in phase at the shared edge. */
  u: number;
}

/** `n` + 1 evenly spaced samples along a prim (tile units). */
export function samplePrim(p: Prim, n: number): Sample[] {
  const out: Sample[] = [];
  const fromCentre = p.kind === 'line' && p.x0 === 0 && p.y0 === 0;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const [x, y] = pointAt(p, k);
    let tx: number;
    let ty: number;
    if (p.kind === 'line') {
      tx = (p.x1 - p.x0) / p.len;
      ty = (p.y1 - p.y0) / p.len;
    } else {
      const a = p.a0 + (p.a1 - p.a0) * k;
      const sg = p.a1 > p.a0 ? 1 : -1;
      tx = -Math.sin(a) * sg;
      ty = Math.cos(a) * sg;
    }
    out.push({ x, y, tx, ty, u: fromCentre ? (1 - k) * p.len : k * p.len });
  }
  return out;
}

/** The half-period that fits a whole number of times in `len`, near `want`. */
export const fitHalf = (len: number, want: number): number => len / Math.max(1, Math.round(len / want));

/* ---------- twisted two-strand cord ---------- */

export interface CordLook {
  /** Cord width (tile units). */
  w: number;
  /** Twist half-period (tile units). */
  half: number;
  /** A soft under-layer (daylight glint, or the lit cord's inner light), drawn first at w × underW. */
  under?: string;
  underW?: number;
  under2?: string;
  under2W?: number;
  /** Strand body (the far strand is drawn darker by `back`). */
  strand: RGB;
  back: number;
  /** The specular line along each strand, toward the light (upper left). */
  hi: string;
  /** A thread between the strands (the lit cord's filament), or none. */
  core?: string;
  coreW?: number;
}

/** Paints a twisted pair along `prims` (tile units, c already scaled so 1 = one tile). */
export function paintCord(c: CanvasRenderingContext2D, prims: readonly Prim[], look: CordLook): void {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const sw = look.w * 0.56;
  const amp = look.w * 0.22;
  if (look.under) {
    c.strokeStyle = look.under;
    c.lineWidth = look.w * (look.underW ?? 2.2);
    strokeAll(c, prims);
  }
  if (look.under2) {
    c.strokeStyle = look.under2;
    c.lineWidth = look.w * (look.under2W ?? 1.5);
    strokeAll(c, prims);
  }
  if (look.core) {
    c.strokeStyle = look.core;
    c.lineWidth = look.w * (look.coreW ?? 0.5);
    strokeAll(c, prims);
  }
  for (const p of prims) {
    const half = fitHalf(p.len, look.half);
    const per = 6;
    const nHalf = Math.round(p.len / half);
    const pts = samplePrim(p, nHalf * per);
    const at = (i: number, sign: number): [number, number] => {
      const q = pts[i];
      const o = sign * amp * Math.sin((Math.PI * q.u) / half);
      return [q.x - q.ty * o, q.y + q.tx * o];
    };
    for (let h = 0; h < nHalf; h++) {
      const i0 = h * per;
      const i1 = i0 + per;
      // The strand on top alternates every half twist.
      const order = h % 2 === 0 ? [1, -1] : [-1, 1];
      for (let k = 0; k < 2; k++) {
        const sign = order[k];
        const top = k === 1;
        c.beginPath();
        for (let i = i0; i <= i1; i++) {
          const [x, y] = at(i, sign);
          if (i === i0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.strokeStyle = css(top ? look.strand : mul3(look.strand, look.back));
        c.lineWidth = sw;
        c.stroke();
        // Specular toward the upper left, inset so it stays on the strand.
        c.save();
        c.translate(-sw * 0.16, -sw * 0.2);
        c.strokeStyle = look.hi;
        c.globalAlpha = top ? 1 : 0.45;
        c.lineWidth = sw * 0.32;
        c.beginPath();
        // Only the middle of each strand segment catches the light (rounded strand).
        for (let i = i0 + 1; i <= i1 - 1; i++) {
          const [x, y] = at(i, sign);
          if (i === i0 + 1) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        c.restore();
      }
    }
  }
}

export function strokeAll(c: CanvasRenderingContext2D, prims: readonly Prim[], q = 1): void {
  c.beginPath();
  for (const p of prims) {
    const k = q >= 1 ? 1 : Math.min(1, Math.max(0, (q - p.t0) / (p.t1 - p.t0)));
    if (k <= 0) continue;
    const [sx, sy] = pointAt(p, 0);
    c.moveTo(sx, sy);
    if (p.kind === 'line') {
      const [x, y] = pointAt(p, k);
      c.lineTo(x, y);
    } else c.arc(p.cx, p.cy, 0.5, p.a0, p.a0 + (p.a1 - p.a0) * k, p.a1 < p.a0);
  }
  c.stroke();
}

/* ---------- fine chain ---------- */

export interface ChainLook {
  /** Link length (tile units). */
  link: number;
  /** Wire thickness of a link. */
  wire: number;
  under?: string;
  underW?: number;
  body: RGB;
  hi: string;
  /** Shadow side of a link. */
  lo: string;
}

/** Paints a fine chain of alternating flat and edge-on links along `prims` (tile units). */
export function paintChain(c: CanvasRenderingContext2D, prims: readonly Prim[], look: ChainLook): void {
  c.lineCap = 'round';
  if (look.under) {
    c.strokeStyle = look.under;
    c.lineWidth = look.underW ?? look.link * 0.9;
    strokeAll(c, prims);
  }
  const step = look.link * 0.82;
  for (const p of prims) {
    const n = Math.max(1, Math.round(p.len / step));
    const pts = samplePrim(p, n * 2);
    // Edge-on links first (they sit under the flat links' ends).
    for (const pass of [1, 0]) {
      for (let j = 0; j < n; j++) {
        const q = pts[j * 2 + 1];
        const flat = Math.round(q.u / (p.len / n) - 0.5) % 2 === 0;
        if ((pass === 0) !== flat) continue;
        const ang = Math.atan2(q.ty, q.tx);
        c.save();
        c.translate(q.x, q.y);
        c.rotate(ang);
        const L = look.link * 0.62;
        if (flat) {
          // An oval ring: shadow, body, then a specular arc on the upper-left.
          c.lineWidth = look.wire;
          c.strokeStyle = look.lo;
          c.beginPath();
          c.ellipse(look.wire * 0.12, look.wire * 0.18, L, look.link * 0.3, 0, 0, TAU);
          c.stroke();
          c.strokeStyle = css(look.body);
          c.beginPath();
          c.ellipse(0, 0, L, look.link * 0.3, 0, 0, TAU);
          c.stroke();
          c.strokeStyle = look.hi;
          c.lineWidth = look.wire * 0.5;
          c.beginPath();
          c.ellipse(0, 0, L, look.link * 0.3, 0, Math.PI * 1.05, Math.PI * 1.65);
          c.stroke();
        } else {
          c.lineWidth = look.wire * 1.25;
          c.strokeStyle = look.lo;
          c.beginPath();
          c.moveTo(-L, look.wire * 0.15);
          c.lineTo(L, look.wire * 0.15);
          c.stroke();
          c.strokeStyle = css(look.body);
          c.lineWidth = look.wire * 1.05;
          c.beginPath();
          c.moveTo(-L, 0);
          c.lineTo(L, 0);
          c.stroke();
          c.strokeStyle = look.hi;
          c.lineWidth = look.wire * 0.4;
          c.beginPath();
          c.moveTo(-L * 0.6, -look.wire * 0.2);
          c.lineTo(L * 0.6, -look.wire * 0.2);
          c.stroke();
        }
        c.restore();
      }
    }
  }
}

/* ---------- halos ---------- */

const haloCache = new Map<string, HTMLCanvasElement>();

/** A soft radial halo sprite (64 px; it is bloomed anyway). `stops`: [offset, alpha] of `color`. */
export function haloSprite(color: RGB, stops: readonly (readonly [number, number])[]): HTMLCanvasElement {
  const key = `${color.join(',')}|${stops.join(';')}`;
  const hit = haloCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, a] of stops) gr.addColorStop(o, css(color, a));
  c.fillStyle = gr;
  c.fillRect(0, 0, 64, 64);
  if (haloCache.size > 200) haloCache.clear();
  haloCache.set(key, cv);
  return cv;
}
