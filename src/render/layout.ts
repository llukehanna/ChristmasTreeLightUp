import type { Grid } from '../core/mask';

export interface Layout {
  w: number;
  h: number;
  dpr: number;
  /** Tile size in CSS px. */
  s: number;
  /** Screen x of the centre column. */
  ox: number;
  /** Screen y of the top of row 0. */
  oy: number;
}

const DESKTOP = { top: 74, bottom: 48 };
const PHONE = { top: 60, bottom: 40 };

/** The scene spans ~12.7 rows (star top to ground) and ~20 columns including glow margins. */
export function computeLayout(w: number, h: number, dpr: number): Layout {
  const phone = w < 600;
  const { top, bottom } = phone ? PHONE : DESKTOP;
  const avail = h - top - bottom;
  const s = Math.max(8, Math.min(avail / 12.7, w / (phone ? 17.6 : 22.2)));
  return { w, h, dpr, s, ox: w / 2, oy: top + 2.35 * s + (avail - 12.7 * s) / 2 };
}

export const X = (L: Layout, u: number): number => L.ox + u * L.s;
export const Y = (L: Layout, v: number): number => L.oy + v * L.s;

export function tileCenter(L: Layout, g: Grid, i: number): [number, number] {
  return [X(L, (i % g.w) - (g.w - 1) / 2), Y(L, Math.floor(i / g.w) + 0.5)];
}

/** The whole grid cell is the hit area: no dead zones between tiles. */
export function tileAt(L: Layout, g: Grid, px: number, py: number): number {
  const col = Math.floor((px - X(L, -g.w / 2)) / L.s);
  const row = Math.floor((py - Y(L, 0)) / L.s);
  if (col < 0 || col >= g.w || row < 0 || row >= g.h) return -1;
  const i = row * g.w + col;
  return g.cells[i] ? i : -1;
}

/** Half-width of the foliage envelope at row `v` (covers every tile of the mask), in tile sizes. */
export const envelope = (v: number): number => Math.min(9.3, 1.3 + Math.max(0, v));

/**
 * How far the tree reaches right of the centre column at row `v`, in tile sizes: the foliage envelope, or the row's
 * own tiles if those reach further (the mask grows one tile each side per row to 8.5 from row 7).
 */
export const foliageHalfWidth = (v: number): number => Math.max(envelope(v), v < 0 ? 0 : Math.min(8.5, Math.floor(v) + 1.5));

/**
 * The tree's right-hand edge in CSS px over a screen band ending at `bottom` (identity camera): the tree widens
 * downward, so the band's bottom is where it reaches furthest.
 */
export function treeRightEdge(L: Layout, bottom: number): number {
  return L.ox + foliageHalfWidth((bottom - L.oy) / L.s) * L.s;
}
