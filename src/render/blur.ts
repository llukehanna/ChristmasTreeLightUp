/** Whether CanvasRenderingContext2D.filter works (missing on older Safari). */
export const CANVAS_FILTER: boolean = (() => {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  c.filter = 'blur(2px)';
  return c.filter === 'blur(2px)';
})();

const scratch = new Map<string, HTMLCanvasElement>();
function scratchCanvas(w: number, h: number, slot: string): HTMLCanvasElement {
  const key = `${slot}:${w}x${h}`;
  let c = scratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    scratch.set(key, c);
  }
  return c;
}

/**
 * Draws `src` stretched over the whole of `dst` (in dst's current transform), blurred by `px` device pixels.
 * Fallback (spec §4.6): downsample to ~1.6/px of the size and scale back up with smoothing.
 */
export function drawBlurred(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, px: number, slot = 'main'): void {
  const w = dst.canvas.width;
  const h = dst.canvas.height;
  if (px < 0.5) {
    dst.drawImage(src, 0, 0, w, h);
    return;
  }
  if (CANVAS_FILTER) {
    dst.filter = `blur(${px}px)`;
    dst.drawImage(src, 0, 0, w, h);
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
  dst.drawImage(tmp, 0, 0, w, h);
}

/** Paints into a fresh full-size layer (CSS-px transform) and composites it onto `dst` blurred by `cssPx`. */
export function blurredLayer(dst: CanvasRenderingContext2D, dpr: number, cssPx: number, paint: (c: CanvasRenderingContext2D) => void): void {
  const layer = document.createElement('canvas');
  layer.width = dst.canvas.width;
  layer.height = dst.canvas.height;
  const c = layer.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(c);
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  drawBlurred(dst, layer, cssPx * dpr, 'layer');
  dst.restore();
}
