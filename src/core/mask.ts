import { D, DELTA, L, R, U, type Dir } from './dirs';

/** The original's tree mask (Config.Xg): '0' = tile, '1' = power source, rows separated by '\r'. */
export const TREE_MASK = [
  '       000',
  '      00000',
  '     0000000',
  '    000000000',
  '   00000000000',
  '  0000000000000',
  ' 000000000000000',
  '00000000000000000',
  '00000000000000000',
  '        1',
].join('\r');

export interface Grid {
  readonly w: number;
  readonly h: number;
  readonly cells: readonly boolean[];
  /** Grid indices of every tile, in row-major order. */
  readonly ids: readonly number[];
  readonly sourceX: number;
  readonly sourceY: number;
  /** The tile directly above the source. */
  readonly root: number;
}

export function parseMask(mask: string): Grid {
  const rows = mask.split('\r');
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const cells = new Array<boolean>(w * h).fill(false);
  let sourceX = -1;
  let sourceY = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '0') cells[y * w + x] = true;
      else if (row[x] === '1') {
        sourceX = x;
        sourceY = y;
      }
    }
  });
  if (sourceX < 0) throw new Error('mask has no source');
  const root = (sourceY - 1) * w + sourceX;
  if (!cells[root]) throw new Error('no tile above the source');
  const ids = cells.flatMap((c, i) => (c ? [i] : []));
  return { w, h, cells, ids, sourceX, sourceY, root };
}

export const GRID: Grid = parseMask(TREE_MASK);

/** Index of the tile next to `i` in direction `d`, or -1 if that is off the board or not a tile. */
export function neighbor(g: Grid, i: number, d: Dir): number {
  const [dx, dy] = DELTA[d];
  const x = (i % g.w) + dx;
  const y = Math.floor(i / g.w) + dy;
  if (x < 0 || x >= g.w || y < 0 || y >= g.h) return -1;
  const j = y * g.w + x;
  return g.cells[j] ? j : -1;
}

/** Direction from tile `a` to the adjacent tile `b`. */
export function dirBetween(g: Grid, a: number, b: number): Dir {
  const dx = (b % g.w) - (a % g.w);
  const dy = Math.floor(b / g.w) - Math.floor(a / g.w);
  if (dx === 1) return R;
  if (dx === -1) return L;
  return dy === 1 ? D : U;
}
