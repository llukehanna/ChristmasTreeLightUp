/** Whether CanvasRenderingContext2D.filter works (missing on older Safari). */
export const CANVAS_FILTER: boolean = (() => {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  if (!('filter' in c)) return false;
  c.filter = 'blur(2px)';
  return c.filter === 'blur(2px)';
})();

const scratch = new Map<string, HTMLCanvasElement>();
function scratchCanvas(w: number, h: number, slot: string): HTMLCanvasElement {
  let c = scratch.get(slot);
  if (!c) {
    c = document.createElement('canvas');
    scratch.set(slot, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/** A rectangle in the destination canvas's device pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draws `src` stretched over the full `dst.canvas` (or over `box`, when given: `src` is then the box's contents) in
 * device pixels, blurred by `px` device pixels.
 * Precondition: caller must set the transform they want (identity for straight composite; renderer also uses vertical flip for reflections).
 * Fallback (spec §4.6): downsample to ~1.6/px of the size and scale back up with smoothing.
 */
export function drawBlurred(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, px: number, slot = 'main', box?: Box): void {
  const x = box ? box.x : 0;
  const y = box ? box.y : 0;
  const w = box ? box.w : dst.canvas.width;
  const h = box ? box.h : dst.canvas.height;
  // A stage with no size yet (a page opened hidden or collapsed) has nothing to blur, and drawImage throws on a 0-size canvas.
  if (w === 0 || h === 0 || src.width === 0 || src.height === 0) return;
  if (px < 0.5) {
    dst.drawImage(src, x, y, w, h);
    return;
  }
  if (CANVAS_FILTER) {
    dst.filter = `blur(${px}px)`;
    dst.drawImage(src, x, y, w, h);
    dst.filter = 'none';
    return;
  }
  const k = Math.min(1, 1.6 / px);
  const tw = Math.max(2, Math.round(w * k));
  const th = Math.max(2, Math.round(h * k));
  const tmp = scratchCanvas(tw, th, slot);
  const t = tmp.getContext('2d');
  if (!t) return;
  t.clearRect(0, 0, tw, th);
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = 'high';
  t.drawImage(src, 0, 0, tw, th);
  dst.imageSmoothingEnabled = true;
  dst.imageSmoothingQuality = 'high';
  dst.drawImage(tmp, x, y, w, h);
}

/**
 * Paints into a fresh full-size layer (CSS-px transform) and composites it onto `dst` blurred by `cssPx`.
 * With `box` (device px of `dst`, clipped to its canvas) the layer, the blur and the composite cover only that box:
 * `paint` still draws in the same CSS-px coordinates, and anything it puts outside the box is dropped, so the box
 * must hold the paint and its blur's tails (about three radii). Does nothing while the canvas has no size.
 */
export function blurredLayer(dst: CanvasRenderingContext2D, dpr: number, cssPx: number, paint: (c: CanvasRenderingContext2D) => void, box?: Box): void {
  const clip = box ? clipBox(box, dst.canvas.width, dst.canvas.height) : null;
  if (box && !clip) return;
  if (!dst.canvas.width || !dst.canvas.height) return;
  const layer = document.createElement('canvas');
  layer.width = clip ? clip.w : dst.canvas.width;
  layer.height = clip ? clip.h : dst.canvas.height;
  const c = layer.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, clip ? -clip.x : 0, clip ? -clip.y : 0);
  paint(c);
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  drawBlurred(dst, layer, cssPx * dpr, 'layer', clip ?? undefined);
  dst.restore();
  layer.width = 0;
  layer.height = 0;
}

/** `box` rounded out to whole pixels and clipped to a `w`×`h` canvas; null when nothing is left. */
export function clipBox(box: Box, w: number, h: number): Box | null {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.w));
  const y1 = Math.min(h, Math.ceil(box.y + box.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
