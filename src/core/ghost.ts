import type { LogEntry } from './log';
import { Playback } from './playback';
import { seededBoard } from './seeded';

/** What a ghost is built from: a finished run (the API's GhostRun satisfies this; core never imports the API). */
export interface GhostSource {
  seed: number;
  genVersion: number;
  log: readonly LogEntry[];
  ms: number;
}

export interface GhostTrack {
  /** The ghost's ranked time (its clock at the solve). */
  readonly ms: number;
  /** Tiles lit at the run's clock `clockMs` (the lit count after every change at or before it). */
  litAt(clockMs: number): number;
}

interface Sample {
  clock: number;
  lit: number;
}

/**
 * The ghost's lit-tiles timeline: `run`'s log played once, on a full (non-headless) board so the lighting is exact,
 * sampling the lit count after each change. Null when the tree can't be made or the log doesn't play to a win.
 * Playback is stepped from one change to the next (its own nextChangeAt), so every sample sits at its exact clock.
 */
export function ghostTrack(run: GhostSource): GhostTrack | null {
  const board = seededBoard(run.seed, run.genVersion);
  if (!board) return null;
  const play = new Playback(board, run.log);
  if (play.solvedAt === null) return null;
  const samples: Sample[] = [{ clock: -Infinity, lit: board.lighting.count }];
  for (let guard = 0; !play.ended; guard++) {
    const at = play.nextChangeAt();
    if (guard > 2 * run.log.length + 8 * board.grid.ids.length + 64) return null;
    const events = play.step(Number.isFinite(at) && at > play.cursor ? at - play.cursor : 1, 1);
    if (!events.some((e) => e.type === 'lightingChanged')) continue;
    const clock = play.clockMs();
    const lit = board.lighting.count;
    if (samples[samples.length - 1].clock === clock) samples[samples.length - 1] = { clock, lit };
    else samples.push({ clock, lit });
  }
  if (!board.won) return null;
  const sampleAt = (clockMs: number): Sample => {
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (samples[mid].clock <= clockMs) lo = mid;
      else hi = mid - 1;
    }
    return samples[lo];
  };
  return { ms: play.clockMs(), litAt: (clockMs) => sampleAt(clockMs).lit };
}
