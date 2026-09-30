import { D, DIRS, OPPOSITE } from './dirs';
import { neighbor, type Grid } from './mask';

export interface Lighting {
  lit: boolean[];
  /** BFS parent of each lit tile (-1 for the root / unlit). */
  parent: number[];
  /** Direction (bit) through which each lit tile receives power. */
  entry: number[];
  /** Lit tiles in BFS order. */
  order: number[];
  children: number[][];
  count: number;
}

/** Faithful port of the original Game.og/Ke: BFS from the root, neighbours in U,D,L,R order. */
export function computeLighting(g: Grid, bits: readonly number[]): Lighting {
  const n = g.w * g.h;
  const lit = new Array<boolean>(n).fill(false);
  const parent = new Array<number>(n).fill(-1);
  const entry = new Array<number>(n).fill(0);
  const children: number[][] = Array.from({ length: n }, () => []);
  const order: number[] = [];
  if (bits[g.root] & D) {
    lit[g.root] = true;
    entry[g.root] = D;
    order.push(g.root);
  }
  for (let h = 0; h < order.length; h++) {
    const i = order[h];
    for (const d of DIRS) {
      if (!(bits[i] & d)) continue;
      const j = neighbor(g, i, d);
      if (j < 0 || lit[j]) continue;
      const o = OPPOSITE[d];
      if (bits[j] & o) {
        lit[j] = true;
        parent[j] = i;
        entry[j] = o;
        children[i].push(j);
        order.push(j);
      }
    }
  }
  return { lit, parent, entry, order, children, count: order.length };
}
