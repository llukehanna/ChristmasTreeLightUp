import type { Board } from '../../../src/core/board';
import { rotCW } from '../../../src/core/dirs';
import type { LogEntry } from '../../../src/core/log';

/** A scripted solver: taps that turn every tile of a settled board to its solution, in grid order, `gap` ms apart from `start`. */
export function solvingTaps(board: Board, start = 1000, gap = 50): LogEntry[] {
  if (board.rotating.size) throw new Error('solvingTaps needs a settled board');
  const out: LogEntry[] = [];
  let t = start;
  for (const i of board.grid.ids) {
    let b = board.bits[i];
    for (let k = 0; k < 4 && b !== board.solution[i]; k++) {
      out.push({ t, a: i });
      t += gap;
      b = rotCW(b);
    }
  }
  return out;
}

/** `log` with a pause of `ms` just after entry k − 1: every entry from k on moves ms + 1 later. */
export function withPause(log: readonly LogEntry[], k: number, ms: number): LogEntry[] {
  const at = log[k - 1].t + 1;
  return [...log.slice(0, k), { t: at, a: 'p' }, { t: at + ms, a: 'r' }, ...log.slice(k).map((e) => ({ t: e.t + ms + 1, a: e.a }))];
}
