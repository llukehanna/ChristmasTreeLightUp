import { D, DIRS, OPPOSITE, type Dir } from './dirs';
import { neighbor, type Grid } from './mask';
import type { Rng } from './rng';

/**
 * Faithful port of the original Game.Ji: a randomized-Prim spanning tree grown from the
 * tile above the source. Returns link bits per grid index (0 for non-tiles).
 */
export function generateSolution(g: Grid, rng: Rng): number[] {
  const bits = new Array<number>(g.w * g.h).fill(0);
  const frontier: [number, Dir][] = [];
  // Push the three edges out of `i` that don't point back the way we came (original push order).
  const pushFrom = (i: number, back: Dir) => {
    for (const d of DIRS) if (d !== back) frontier.push([i, d]);
  };

  bits[g.root] = D; // connects down to the source
  pushFrom(g.root, D);

  while (frontier.length > 0) {
    const k = Math.floor(rng() * frontier.length);
    const [from, dir] = frontier[k];
    const to = neighbor(g, from, dir);
    if (to >= 0 && bits[to] === 0) {
      bits[from] |= dir;
      bits[to] = OPPOSITE[dir];
      pushFrom(to, OPPOSITE[dir]);
    }
    frontier.splice(k, 1);
  }
  return bits;
}
