import type { FinishResult } from './types';

/** What became of the run on the results tag (spec §5, §8). */
export type RunOutcome =
  /** A local tree: the server didn't answer the start in time, or a save from before accounts. */
  | { kind: 'offline' }
  /** The finish is on its way. */
  | { kind: 'saving' }
  /** The finish didn't reach the server, even after the retry. */
  | { kind: 'failed' }
  /** The server couldn't replay the log (422) and dropped the game. */
  | { kind: 'unverified' }
  | { kind: 'done'; result: FinishResult };
