import { computeLighting, type Board, type BoardState } from '../core/board';
import type { Grid } from '../core/mask';
import { orientationsOf } from '../core/scramble';
import { readJSON, removeKey, writeJSON } from './storage';

export interface SavedGame {
  v: 1;
  solution: number[];
  bits: number[];
  colors: number[];
  elapsedMs: number;
}

const KEY = 'aglow.game';

export function saveGame(board: Board, elapsedMs: number): void {
  const saved: SavedGame = {
    v: 1,
    solution: [...board.solution],
    bits: board.settledBits(),
    colors: [...board.colors],
    elapsedMs: Math.round(elapsedMs),
  };
  writeJSON(KEY, saved);
}

export const clearGame = (): void => removeKey(KEY);

/** Validates a save against the mask: right sizes, legal orientations, and a solution that is a full spanning tree. */
function validator(g: Grid) {
  return (v: unknown): v is SavedGame => {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    const n = g.w * g.h;
    const isArr = (x: unknown): x is number[] => Array.isArray(x) && x.length === n && x.every((e) => Number.isInteger(e));
    if (o.v !== 1 || !isArr(o.solution) || !isArr(o.bits) || !isArr(o.colors)) return false;
    if (typeof o.elapsedMs !== 'number' || !Number.isFinite(o.elapsedMs) || o.elapsedMs < 0) return false;
    const solution = o.solution as number[];
    const bits = o.bits as number[];
    const colors = o.colors as number[];
    for (let i = 0; i < n; i++) {
      if (!g.cells[i]) {
        if (solution[i] !== 0 || bits[i] !== 0) return false;
        continue;
      }
      try {
        if (!orientationsOf(solution[i]).includes(bits[i])) return false;
      } catch {
        return false;
      }
      if (colors[i] < 0 || colors[i] > 5) return false;
    }
    return computeLighting(g, solution).count === g.ids.length;
  };
}

export function loadGame(g: Grid): { state: BoardState; elapsedMs: number } | null {
  const s = readJSON(KEY, validator(g));
  if (!s) return null;
  return { state: { solution: s.solution, bits: s.bits, colors: s.colors }, elapsedMs: s.elapsedMs };
}
