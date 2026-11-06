import { mulberry32 } from '../core/rng';
import type { Layout } from './layout';
import { paintParlour } from './parlour';
import { paintSash } from './sash';
import type { Scene } from './scenes';
import { paintSquare } from './square';
import { Snowfall } from './window-kit';

/**
 * A scene that paints its own room into the background layer (in place of paint-background.ts) and draws a little of
 * it per frame: the Sash's snow behind the glass and its street lamp's glow, the Town square's lamps, the Parlour's
 * candles, coals, clock and window snow. Rebuilt from the layout at every repaint, so nothing it holds outlives a
 * resize or a change of scene.
 */
export interface Backdrop {
  /** Per frame, behind the tree, CSS-px transform set (scale dpr). */
  back(c: CanvasRenderingContext2D, now: number, reduced: boolean, tier: number): void;
  /** Per frame, on the half-res glow layer (CSS-px transform at the glow's scale). */
  glow(g: CanvasRenderingContext2D, now: number, reduced: boolean, tier: number): void;
}

/** Paints `sc`'s own room into the background layer and returns its per-frame parts; null for scenes paintBackground draws. */
export function paintBackdrop(c: CanvasRenderingContext2D, L: Layout, sc: Scene): Backdrop | null {
  if (sc.id !== 'sash' && sc.id !== 'square' && sc.id !== 'parlour') return null;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  switch (sc.id) {
    case 'sash':
      // The lab's seed for the Sash's snow ('sash'.length * 977 + 13).
      return new Snowfall(paintSash(c, L), L, mulberry32(4 * 977 + 13));
    case 'square':
      return paintSquare(c, L);
    case 'parlour':
      return paintParlour(c, L);
  }
}
