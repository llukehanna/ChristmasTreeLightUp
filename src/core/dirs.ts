export const U = 1;
export const D = 2;
export const L = 4;
export const R = 8;
export type Dir = typeof U | typeof D | typeof L | typeof R;

/** Neighbour-check order used by the original (Game.og): up, down, left, right. */
export const DIRS: readonly Dir[] = [U, D, L, R];
export const OPPOSITE: Readonly<Record<Dir, Dir>> = { [U]: D, [D]: U, [L]: R, [R]: L };
export const DELTA: Readonly<Record<Dir, readonly [number, number]>> = {
  [U]: [0, -1],
  [D]: [0, 1],
  [L]: [-1, 0],
  [R]: [1, 0],
};

/** 90° clockwise, as in the original Block.hm: U→R, R→D, D→L, L→U. */
export function rotCW(b: number): number {
  return (b & U ? R : 0) | (b & R ? D : 0) | (b & D ? L : 0) | (b & L ? U : 0);
}

export function degree(b: number): number {
  return (b & U ? 1 : 0) + (b & D ? 1 : 0) + (b & L ? 1 : 0) + (b & R ? 1 : 0);
}

export function dirsOf(b: number): Dir[] {
  return DIRS.filter((d) => (b & d) !== 0);
}
