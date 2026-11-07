import { Board, type BoardEvent } from './board';
import { REVEAL_MS } from './clock';
import { tapOf, type LogEntry } from './log';
import { replay } from './replay';

/**
 * Plays a run's log on a board in log time, the way the judge's replay does (src/core/replay.ts), but in slices of
 * real time. Side by side:
 *
 *   replay():  for each entry:  board.advanceTo(t);  then a pause or resume flips `paused`, or board.tap(tile, t, dir)
 *   step():    for each entry due by the playhead:  board.advanceTo(t);  then the same;  finally board.advanceTo(playhead)
 *
 * Time only moves through advanceTo, which finishes turns at their exact times, so a slice lands on exactly the board
 * replay() builds, whatever the slice sizes. step() never calls board.tick with real time. A pause in the log is
 * skipped: the playhead jumps from its 'p' to the matching 'r' (to the solve when none follows), so a replay never
 * shows dead air, and the clock reads the run's active time.
 */
export class Playback {
  private readonly board: Board;
  private readonly log: readonly LogEntry[];
  private cursorMs = 0;
  /** Index of the next log entry not yet played. */
  private next = 0;
  private paused = false;
  /** Where the open pause counts from: its start, or the end of the reveal if that comes later. */
  private pausedSince = 0;
  /** Paused time before the playhead, in closed pauses. */
  private pausedMs = 0;
  /** Log time of the solve (from replay() on a headless copy); null when the log doesn't solve. */
  readonly solvedAt: number | null;

  /** `board` is fresh (nothing tapped, nothing turning): the tree the log was played on. */
  constructor(board: Board, log: readonly LogEntry[]) {
    this.board = board;
    this.log = log;
    // The constructor can't know the seed, so the headless copy is built from the fresh board's own state.
    const headless = new Board(board.grid, { solution: [...board.solution], bits: board.settledBits(), colors: [...board.colors] }, board.rotateMs, true);
    this.solvedAt = replay(headless, log)?.solvedAt ?? null;
  }

  /** Log time of the playhead (0 at the reveal's start). Only grows. */
  get cursor(): number {
    return this.cursorMs;
  }

  /** The run's clock at the playhead: log time minus the reveal and the pauses before it, never below 0. */
  clockMs(): number {
    const open = this.paused ? Math.max(0, this.cursorMs - this.pausedSince) : 0;
    return Math.max(0, this.cursorMs - REVEAL_MS - this.pausedMs - open);
  }

  /** Log time of the next change to the board: a log entry or a turn finishing. Infinity when nothing is left. */
  nextChangeAt(): number {
    let at = this.next < this.log.length ? this.log[this.next].t : Infinity;
    for (const r of this.board.rotating.values()) at = Math.min(at, r.t0 + this.board.rotateMs);
    return at;
  }

  /**
   * Moves the playhead by realMs × speed; a playhead that lands inside a pause jumps to its resume (the time left in
   * the slice carries on from there). Returns the board's events, exactly as replay() would produce them, in order.
   * Nothing after the solve.
   */
  step(realMs: number, speed: 1 | 2): BoardEvent[] {
    const events: BoardEvent[] = [];
    if (this.ended || !(realMs > 0)) return events;
    let target = this.cursorMs + realMs * speed;
    while (this.next < this.log.length && this.log[this.next].t <= target) {
      const { t, a } = this.log[this.next++];
      if (this.moveTo(t, events)) return events;
      if (a === 'p') {
        this.paused = true;
        this.pausedSince = Math.max(t, REVEAL_MS);
        target = this.skipPast(t, target);
      } else if (a === 'r') {
        this.pausedMs += Math.max(0, t - this.pausedSince);
        this.paused = false;
      } else if (!this.paused) {
        const { tile, dir } = tapOf(a);
        for (const e of this.board.tap(tile, t, dir)) events.push(e);
      }
    }
    this.moveTo(target, events);
    return events;
  }

  /** The solve has been played, or (a log that doesn't solve) every entry has and the last turn has settled. */
  get ended(): boolean {
    return this.board.won || (this.solvedAt === null && this.next >= this.log.length && this.board.rotating.size === 0);
  }

  /** Advances the board to log time `t`; true when the tree is won on the way (the playhead stops at the solve). */
  private moveTo(t: number, out: BoardEvent[]): boolean {
    const won = this.board.advanceTo(t, out);
    this.cursorMs = Math.max(this.cursorMs, won ?? t);
    return won !== null;
  }

  /** A pause began at `from`: carry the slice's remaining time past its resume (past the solve when none follows). */
  private skipPast(from: number, target: number): number {
    for (let k = this.next; k < this.log.length; k++) if (this.log[k].a === 'r') return target + this.log[k].t - from;
    return this.solvedAt === null ? target : Math.max(target, this.solvedAt);
  }
}
