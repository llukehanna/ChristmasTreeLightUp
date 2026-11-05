/**
 * The window scenes' kit (src/render/sash.ts), ported from the lab: a dark room seen from inside, looking out of a
 * window at snow. The painter paints everything static once and hands back a WindowSpec: the glass as a clip path, the
 * snow's depth layers, a warm light the flakes catch and light that blooms. Per frame the snow is one drawImage per
 * flake from a handful of cached sprites (and one fillRect per far sheet), clipped to the panes; no gradients, no
 * shadows, no filters and no allocation.
 */
import type { Rng } from '../core/rng';
import type { Backdrop } from './backdrop';
import type { Layout } from './layout';
import { TAU } from './paint-util';
import { deviceLayer, linear, softSprite } from './scene-util';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One depth layer of falling snow. Sizes and speeds are in tiles, so the snow scales with the board. */
export interface FlakeLayer {
  n: number;
  /** Sprite diameter, tiles (min, max). */
  size: readonly [number, number];
  /** Fall speed, tiles per second (min, max). */
  fall: readonly [number, number];
  alpha: number;
  /** pin: small and crisp (far); soft: mid; blur: big defocused discs (near the glass). */
  look: 'pin' | 'soft' | 'blur';
  /** Side-to-side sway amplitude, tiles. */
  sway: number;
  /** How much of the wind this layer feels (nearer flakes drift further across the view). */
  drift: number;
}

/**
 * The furthest snow as a scrolling sheet: one pre-rendered tile of many tiny flakes, filled across the glass as a
 * pattern and slid down each frame (one fillRect for hundreds of flakes).
 */
export interface SheetLayer {
  /** Flakes in one tile. */
  n: number;
  /** Tile size, tiles. */
  tile: number;
  size: readonly [number, number];
  /** Fall speed, tiles per second. */
  fall: number;
  alpha: number;
  sway: number;
  drift: number;
}

/** A light outside the glass that the flakes passing near it catch. */
export interface WarmLight {
  x: number;
  y: number;
  r: number;
  rgb: string;
  gain: number;
}

export interface Glow {
  x: number;
  y: number;
  r: number;
  a: number;
  rgb: string;
}

export interface WindowSpec {
  /** The glass the snow is seen through (the panes, never the bars). */
  glass: Path2D;
  box: { x0: number; y0: number; x1: number; y1: number };
  layers: readonly FlakeLayer[];
  sheets?: readonly SheetLayer[];
  /** Mean wind, tiles per second (+ blows to the right). */
  wind: number;
  rgb: string;
  warm?: WarmLight;
  glows?: Glow[];
}

/* ---------------- the snow ---------------- */

interface Live {
  spec: FlakeLayer;
  spr: HTMLCanvasElement;
  warmSpr: HTMLCanvasElement | null;
  x: Float32Array;
  y: Float32Array;
  sz: Float32Array;
  v: Float32Array;
  p: Float32Array;
  f: Float32Array;
  sway: number;
}

const LOOK = { pin: [5, 0.45], soft: [8, 0.22], blur: [16, 0] } as const;

interface Sheet {
  spec: SheetLayer;
  pat: CanvasPattern;
  size: number;
  x: number;
  y: number;
}

/** The snow outside the window: the backdrop's per-frame part. */
export class Snowfall implements Backdrop {
  private readonly live: Live[];
  private readonly sheets: Sheet[];
  /** The glows' sprites, one per glow, made once. */
  private readonly glowSpr: HTMLCanvasElement[];
  /** The sheets' pattern transform, reused every frame. */
  private readonly mat: DOMMatrix | null;
  private readonly dpr: number;
  private last = 0;
  /** The snow's own clock (s): it stops while motion is reduced, so the sway freezes with the fall. */
  private t = 0;
  private readonly m: number;
  private readonly s: number;

  constructor(readonly spec: WindowSpec, L: Layout, r: Rng) {
    const s = L.s;
    this.s = s;
    this.dpr = L.dpr;
    const { x0, y0, x1, y1 } = spec.box;
    this.sheets = (spec.sheets ?? []).map((sh) => {
      const T = Math.round(sh.tile * s);
      const [cv, c] = deviceLayer(L, T, T);
      const spr = softSprite(spec.rgb, LOOK.pin[0], LOOK.pin[1]);
      for (let i = 0; i < sh.n; i++) {
        const x = r() * T;
        const y = r() * T;
        const sz = (sh.size[0] + r() * (sh.size[1] - sh.size[0])) * s;
        c.globalAlpha = 0.55 + r() * 0.45;
        // drawn wrapped, so the tile repeats seamlessly
        for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) c.drawImage(spr, x + dx - sz / 2, y + dy - sz / 2, sz, sz);
      }
      return { spec: sh, pat: c.createPattern(cv, 'repeat')!, size: T, x: r() * T, y: r() * T };
    });
    this.mat = this.sheets.length ? new DOMMatrix() : null;
    this.glowSpr = (spec.glows ?? []).map((gl) => softSprite(gl.rgb, 32, 0));
    this.m = Math.max(...spec.layers.map((l) => l.size[1])) * s + Math.max(...spec.layers.map((l) => l.sway)) * s;
    this.live = spec.layers.map((l) => {
      const [px, hard] = LOOK[l.look];
      const n = l.n;
      const lv: Live = {
        spec: l,
        spr: softSprite(spec.rgb, px, hard),
        warmSpr: spec.warm ? softSprite(spec.warm.rgb, px, hard) : null,
        x: new Float32Array(n),
        y: new Float32Array(n),
        sz: new Float32Array(n),
        v: new Float32Array(n),
        p: new Float32Array(n),
        f: new Float32Array(n),
        sway: l.sway * s,
      };
      for (let i = 0; i < n; i++) {
        lv.x[i] = x0 - this.m + r() * (x1 - x0 + 2 * this.m);
        lv.y[i] = y0 - this.m + r() * (y1 - y0 + 2 * this.m);
        lv.sz[i] = (l.size[0] + r() * (l.size[1] - l.size[0])) * s;
        lv.v[i] = (l.fall[0] + r() * (l.fall[1] - l.fall[0])) * s;
        lv.p[i] = r() * TAU;
        lv.f[i] = 0.35 + r() * 0.6;
      }
      return lv;
    });
  }

  /** Every flake moves; from tier 2 only half of each layer is drawn, and tier 3 skips the warm pass. */
  back(c: CanvasRenderingContext2D, now: number, reduced: boolean, tier: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const move = !reduced && dt > 0;
    if (move) this.t += dt;
    const t = this.t;
    const { x0, y0, x1, y1 } = this.spec.box;
    const m = this.m;
    const spanX = x1 - x0 + 2 * m;
    const spanY = y1 - y0 + 2 * m;
    // Gentle, slowly breathing wind; never a gust.
    const wind = this.spec.wind * this.s * (0.75 + 0.25 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.67 + 1.3));
    c.save();
    c.clip(this.spec.glass);
    const mat = this.mat;
    for (let k = 0; k < this.sheets.length; k++) {
      const sh = this.sheets[k];
      if (move) {
        sh.y = (sh.y + sh.spec.fall * this.s * dt) % sh.size;
        sh.x = (sh.x + wind * sh.spec.drift * dt) % sh.size;
      }
      const sx = sh.x + Math.sin(t * 0.45 + sh.size) * sh.spec.sway * this.s;
      // translate(x0 + sx, y0 + y) · scale(1 / dpr): the device-px tile laid out in CSS px.
      if (mat) {
        mat.a = mat.d = 1 / this.dpr;
        mat.b = mat.c = 0;
        mat.e = x0 + sx;
        mat.f = y0 + sh.y;
        sh.pat.setTransform(mat);
      }
      c.globalAlpha = sh.spec.alpha;
      c.fillStyle = sh.pat;
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const half = tier >= 2;
    for (let k = 0; k < this.live.length; k++) {
      const lv = this.live[k];
      const n = lv.x.length;
      const drawn = half ? Math.ceil(n / 2) : n;
      c.globalAlpha = lv.spec.alpha;
      const drift = wind * lv.spec.drift * dt;
      for (let i = 0; i < n; i++) {
        if (move) {
          lv.y[i] += lv.v[i] * dt;
          lv.x[i] += drift;
          if (lv.y[i] > y1 + m) {
            lv.y[i] -= spanY;
            lv.x[i] = x0 - m + Math.random() * spanX;
          }
          if (lv.x[i] > x1 + m) lv.x[i] -= spanX;
          else if (lv.x[i] < x0 - m) lv.x[i] += spanX;
        }
        if (i >= drawn) continue;
        const sz = lv.sz[i];
        const x = lv.x[i] + Math.sin(t * lv.f[i] + lv.p[i]) * lv.sway;
        c.drawImage(lv.spr, x - sz / 2, lv.y[i] - sz / 2, sz, sz);
      }
    }
    const w = this.spec.warm;
    if (w && tier < 3) {
      // The flakes passing through the lamp's light catch it: a second, additive pass for just those.
      c.globalCompositeOperation = 'lighter';
      const r2 = w.r * w.r;
      for (let k = 0; k < this.live.length; k++) {
        const lv = this.live[k];
        const drawn = half ? Math.ceil(lv.x.length / 2) : lv.x.length;
        for (let i = 0; i < drawn; i++) {
          const x = lv.x[i] + Math.sin(t * lv.f[i] + lv.p[i]) * lv.sway;
          const dx = x - w.x;
          const dy = lv.y[i] - w.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2) continue;
          const q = 1 - d2 / r2;
          c.globalAlpha = Math.min(1, q * q * w.gain * lv.spec.alpha);
          const sz = lv.sz[i];
          c.drawImage(lv.warmSpr!, x - sz / 2, lv.y[i] - sz / 2, sz, sz);
        }
      }
      c.globalCompositeOperation = 'source-over';
    }
    c.globalAlpha = 1;
    c.restore();
  }

  glow(g: CanvasRenderingContext2D): void {
    const glows = this.spec.glows;
    if (!glows) return;
    for (let k = 0; k < glows.length; k++) {
      const gl = glows[k];
      g.globalAlpha = gl.a;
      g.drawImage(this.glowSpr[k], gl.x - gl.r, gl.y - gl.r, gl.r * 2, gl.r * 2);
    }
    g.globalAlpha = 1;
  }
}

/* ---------------- painting helpers ---------------- */

/** A grid of panes inside `r`: `cols` × `rows`, separated by bars `bar` wide. */
export function panes(r: Rect, cols: number, rows: number, bar: number): Rect[] {
  const out: Rect[] = [];
  const pw = (r.w - bar * (cols - 1)) / cols;
  const ph = (r.h - bar * (rows - 1)) / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: r.x + i * (pw + bar), y: r.y + j * (ph + bar), w: pw, h: ph });
  return out;
}

export function boxOf(rects: readonly Rect[]): WindowSpec['box'] {
  return {
    x0: Math.min(...rects.map((q) => q.x)),
    y0: Math.min(...rects.map((q) => q.y)),
    x1: Math.max(...rects.map((q) => q.x + q.w)),
    y1: Math.max(...rects.map((q) => q.y + q.h)),
  };
}

/** The faint halation of the night at the edges of the glass, where it meets the dark bars. */
export function glassEdge(c: CanvasRenderingContext2D, glass: Path2D, rgba: string): void {
  c.save();
  c.strokeStyle = rgba;
  c.lineWidth = 1;
  c.stroke(glass);
  c.restore();
}

/** A rolling snowbank whose top runs from x0 to x1 around y (± amp), filled down to `bottom`. */
export function snowbank(c: CanvasRenderingContext2D, x0: number, x1: number, y: number, amp: number, bottom: number, r: Rng, fill: string | CanvasGradient): void {
  const n = 7;
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  c.beginPath();
  c.moveTo(x0, bottom);
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const yy = y + amp * (0.55 * Math.sin(t * n * 0.6 + ph[0]) + 0.3 * Math.sin(t * n * 1.7 + ph[1]) + 0.15 * Math.sin(t * n * 4.1 + ph[2]));
    c.lineTo(x0 + (x1 - x0) * t, yy);
  }
  c.lineTo(x1, bottom);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

/** A heavy curtain in deep folds, almost lost in the dark; `rgb` is the cloth, `lit` the light catching the crests. */
export function drape(c: CanvasRenderingContext2D, s: number, x0: number, x1: number, y0: number, y1: number, r: Rng, rgb: string, lit: string): void {
  const wd = x1 - x0;
  c.save();
  c.beginPath();
  c.rect(x0, y0, wd, y1 - y0);
  c.fillStyle = `rgb(${rgb})`;
  c.fill();
  c.clip();
  const folds = Math.max(3, Math.round(wd / (s * 0.38)));
  for (let i = 0; i < folds; i++) {
    const fx = x0 - s * 0.2 + ((wd + s * 0.4) * (i + r() * 0.3)) / folds;
    const fw = (wd / folds) * (1.1 + r() * 0.5);
    const a = 0.5 + r() * 0.5;
    c.fillStyle = linear(c, fx, 0, fx + fw, 0, [[0, 'rgba(0,0,0,.6)'], [0.5, `rgba(${lit},${0.06 * a})`], [0.6, `rgba(${lit},${0.035 * a})`], [1, 'rgba(0,0,0,.5)']]);
    c.fillRect(fx, y0, fw, y1 - y0);
  }
  c.fillStyle = linear(c, 0, y0, 0, y1, [[0, 'rgba(0,0,0,.55)'], [0.6, 'rgba(0,0,0,.15)'], [1, 'rgba(0,0,0,.35)']]);
  c.fillRect(x0, y0, wd, y1 - y0);
  c.restore();
}

/** Dark floorboards from the skirting to the bottom of the frame. */
export function floor(c: CanvasRenderingContext2D, L: Layout, hz: number, top: string, bottom: string): void {
  const { w, h, s } = L;
  c.fillStyle = linear(c, 0, hz, 0, h, [[0, top], [1, bottom]]);
  c.fillRect(0, hz, w, h - hz);
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.lineWidth = 1;
  for (let y = hz + s * 0.22; y < h; y += s * 0.26 + (y - hz) * 0.1) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
}

/** Snow that has drifted against the outside of a pane's bottom edge: a low pale ridge, deeper at the corners. */
export function paneDrift(c: CanvasRenderingContext2D, q: Rect, depth: number, r: Rng, fill: string): void {
  c.save();
  c.beginPath();
  c.rect(q.x, q.y, q.w, q.h);
  c.clip();
  const y = q.y + q.h;
  c.beginPath();
  c.moveTo(q.x, y);
  c.lineTo(q.x, y - depth * (1.6 + r() * 0.6));
  const n = 24;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const corner = Math.pow(Math.abs(t - 0.5) * 2, 3);
    c.lineTo(q.x + q.w * t, y - depth * (0.5 + 0.25 * Math.sin(t * 9 + r()) + corner * 1.2));
  }
  c.lineTo(q.x + q.w, y - depth * (1.6 + r() * 0.6));
  c.lineTo(q.x + q.w, y);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.restore();
}
