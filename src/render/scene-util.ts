import { blurredLayer } from './blur';
import type { Layout } from './layout';
import { TAU, canvas } from './paint-util';

/** Small drawing helpers for the scenes that paint their own room (src/render/sash.ts), ported from the lab's scenes-util. */

export function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, Math.max(0, r), 0, TAU);
  c.fill();
}

export function radial(c: CanvasRenderingContext2D, x: number, y: number, r: number, stops: readonly (readonly [number, string])[]): void {
  if (r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

export function linear(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

/** A canvas in device pixels for `w`×`h` CSS px of the layout, painted with a CSS-px transform. */
export function deviceLayer(L: Layout, w = L.w, h = L.h): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const [cv, c] = canvas(Math.max(1, Math.round(w * L.dpr)), Math.max(1, Math.round(h * L.dpr)));
  c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  return [cv, c];
}

/** Paints with `paint` (CSS px) and blurs it into `dst` by `cssPx` (blur.ts's blurredLayer), composited with `op`. */
export function blurInto(dst: CanvasRenderingContext2D, L: Layout, cssPx: number, paint: (c: CanvasRenderingContext2D) => void, op: GlobalCompositeOperation = 'source-over'): void {
  dst.save();
  dst.globalCompositeOperation = op;
  blurredLayer(dst, L.dpr, cssPx, paint);
  dst.restore();
}

/** Film grain baked into a layer (fine, monochrome, ±amp). */
export function grain(c: CanvasRenderingContext2D, amp: number, seed = 7): void {
  const cv = c.canvas;
  const n = 256;
  const [t, tc] = canvas(n, n);
  const img = tc.createImageData(n, n);
  let a = seed >>> 0;
  for (let i = 0; i < n * n; i++) {
    a = (a * 1664525 + 1013904223) >>> 0;
    const v = (a >>> 24) / 255;
    const k = v < 0.5 ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k;
    img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * amp * 255);
  }
  tc.putImageData(img, 0, 0);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'soft-light';
  const p = c.createPattern(t, 'repeat');
  if (p) {
    c.fillStyle = p;
    c.fillRect(0, 0, cv.width, cv.height);
  }
  c.restore();
}

/**
 * A soft round sprite (white core falloff) for cheap per-frame flakes and glows. Built at paint time (its cache key is
 * a string): whatever draws one per frame keeps the sprite it was given.
 */
const sprites = new Map<string, HTMLCanvasElement>();
export function softSprite(rgb: string, px: number, hard = 0): HTMLCanvasElement {
  const key = `${rgb}|${px}|${hard}`;
  let s = sprites.get(key);
  if (s) return s;
  const n = Math.max(4, Math.ceil(px * 2));
  const [cv, c] = canvas(n, n);
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(Math.max(0.01, hard), `rgba(${rgb},${hard ? 0.95 : 0.6})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  s = cv;
  sprites.set(key, s);
  return s;
}
