import type { Rgb } from './scenes';

/** Small helpers shared by the one-off painters (topper-art, decor), ported from the lab's trees-util. */

export const TAU = Math.PI * 2;
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t: number): number => t * t * (3 - 2 * t);
const byte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const css = (c: Rgb, a = 1): string => (a >= 1 ? `rgb(${byte(c[0])},${byte(c[1])},${byte(c[2])})` : `rgba(${byte(c[0])},${byte(c[1])},${byte(c[2])},${Math.max(0, a).toFixed(3)})`);
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A fresh canvas of at least 1×1 device px and its 2D context. */
export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D is unavailable');
  return [c, x];
}
