import { D, L, R, U } from './dirs';
import type { Grid } from './mask';
import type { Rng } from './rng';

/** Orientation classes from the original Game.Oi. */
const CLASSES: readonly (readonly number[])[] = [
  [U, D, L, R],
  [U | D, L | R],
  [U | L, U | R, L | D, R | D],
  [U | L | R, U | L | D, U | R | D, L | R | D],
  [U | D | L | R],
];

export function orientationsOf(b: number): readonly number[] {
  const cls = CLASSES.find((c) => c.includes(b));
  if (!cls) throw new Error(`not a tile shape: ${b}`);
  return cls;
}

export function randomOrientation(b: number, rng: Rng): number {
  const cls = orientationsOf(b);
  return cls[Math.floor(rng() * cls.length)];
}

/** Every tile independently takes a uniformly random orientation of its own shape (may already be correct). */
export function scramble(g: Grid, solution: readonly number[], rng: Rng): number[] {
  return solution.map((b, i) => (g.cells[i] ? randomOrientation(b, rng) : 0));
}

/** Original Block.xi: floor(random * 6) per tile; only visible on end tiles (bulbs). */
export function randomColors(g: Grid, rng: Rng): number[] {
  return g.cells.map((c) => (c ? Math.floor(rng() * 6) : 0));
}
