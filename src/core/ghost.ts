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
  /** The lit tiles at `clockMs` (for the glow look); the same set object until the lit tiles change. */
  tilesAt(clockMs: number): ReadonlySet<number>;
}

interface Sample {
  clock: number;
  tiles: ReadonlySet<number>;
}

/**
 * The ghost's lit-tiles timeline: `run`'s log played once, on a full (non-headless) board so the lighting is exact,
 * sampling the lit tiles after each change. Null when the tree can't be made or the log doesn't play to a win.
 * Playback is stepped from one change to the next (its own nextChangeAt), so every sample sits at its exact clock.
 */
export function ghostTrack(run: GhostSource): GhostTrack | null {
  const board = seededBoard(run.seed, run.genVersion);
  if (!board) return null;
  const play = new Playback(board, run.log);
  if (play.solvedAt === null) return null;
  const samples: Sample[] = [{ clock: -Infinity, tiles: new Set(board.lighting.order) }];
  for (let guard = 0; !play.ended; guard++) {
    const at = play.nextChangeAt();
    if (guard > 2 * run.log.length + 8 * board.grid.ids.length + 64) return null;
    const events = play.step(Number.isFinite(at) && at > play.cursor ? at - play.cursor : 1, 1);
    if (!events.some((e) => e.type === 'lightingChanged')) continue;
    const clock = play.clockMs();
    const tiles = new Set(board.lighting.order);
    if (samples[samples.length - 1].clock === clock) samples[samples.length - 1] = { clock, tiles };
    else samples.push({ clock, tiles });
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
  return { ms: play.clockMs(), litAt: (clockMs) => sampleAt(clockMs).tiles.size, tilesAt: (clockMs) => sampleAt(clockMs).tiles };
}
