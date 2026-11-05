import { mulberry32 } from '../core/rng';
import type { Layout } from './layout';
import { paintSash } from './sash';
import type { Scene } from './scenes';
import { Snowfall } from './window-kit';

/**
 * A scene that paints its own room into the background layer (in place of paint-background.ts) and draws a little of
 * it per frame: the Sash's snow behind the glass and its street lamp's glow. Rebuilt from the layout at every repaint.
 */
export interface Backdrop {
  /** Per frame, behind the tree, CSS-px transform set (scale dpr). */
  back(c: CanvasRenderingContext2D, now: number, reduced: boolean, tier: number): void;
  /** Per frame, on the half-res glow layer. */
  glow(g: CanvasRenderingContext2D): void;
}

/** Paints `sc`'s own room into the background layer and returns its per-frame parts; null for scenes paintBackground draws. */
export function paintBackdrop(c: CanvasRenderingContext2D, L: Layout, sc: Scene): Backdrop | null {
  if (sc.id !== 'sash') return null;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  const spec = paintSash(c, L);
  // The lab's seed for the Sash's snow ('sash'.length * 977 + 13).
  return new Snowfall(spec, L, mulberry32(4 * 977 + 13));
}
