// DEV ONLY (C4 task 6): a synthetic ghost for Luke's side-by-side of the ghost's two looks (`?test&ghostdemo` on a dev
// build). Imported only behind `import.meta.env.DEV`, so no production build holds it. Deleted after Luke's pick (task 6, step 4).
import { Board, computeLighting } from '../core/board';
import { REVEAL_MS } from '../core/clock';
import { rotCW } from '../core/dirs';
import { ghostTrackOn, type GhostTrack } from '../core/ghost';
import type { LogEntry } from '../core/log';

/** About how long the demo ghost takes from the clock's start to the solve. */
const DEMO_MS = 45_000;

/**
 * A ghost for the tree in play: a solve of that same board, built here (tiles in the order the light reaches them, each
 * by its shortest turn, as tests/unit/core/solver.ts's shortestTaps does) and spaced to finish in about DEMO_MS.
 */
export function demoGhostTrack(board: Board): GhostTrack | null {
  const bits = board.settledBits();
  const taps: number[] = [];
  for (const i of computeLighting(board.grid, board.solution).order) {
    let k = 0;
    for (let b = bits[i]; k < 4 && b !== board.solution[i]; k++) b = rotCW(b);
    for (let n = 0; n < (k === 3 ? 1 : k); n++) taps.push(k === 3 ? ~i : i);
  }
  if (taps.length === 0) return null;
  const gap = Math.max(50, Math.floor(DEMO_MS / taps.length));
  const log: LogEntry[] = taps.map((a, n) => ({ t: REVEAL_MS + 500 + n * gap, a }));
  // The track plays a copy: the board in play keeps its own state.
  return ghostTrackOn(new Board(board.grid, { solution: [...board.solution], bits, colors: [...board.colors] }, board.rotateMs), log);
}
