import type { Board, BoardEvent } from './board';
import { GameClock, REVEAL_MS } from './clock';
import { GameLog, type LogEntry } from './log';

export interface RunStart {
  /** performance.now() as the tree appears: the reveal starts. */
  now: number;
  /** Date.now() at the same instant. */
  epochNow: number;
  /** Date.now() when this tree first began (log times count from here); a restored tree keeps its own. */
  startEpoch: number;
  /** Clock time already played (a restored tree). */
  elapsedMs: number;
  /** The log so far (a restored tree). */
  log: readonly LogEntry[];
}

/**
 * One tree in play in the browser: its board, clock and log, kept exactly in step with the server's replay
 * (src/core/replay.ts) so an honest run always verifies (spec 2026-10-07 §5.2):
 * - the board runs on integer ms, a fixed whole number of ms behind log time, so "has this turn finished?" is answered
 *   the same way here and in the replay;
 * - turns finish at their exact finishing times, in order (Board.advanceTo, which the replay uses too), however late a frame comes;
 * - before a tap goes in, every turn due by then finishes; only taps the board accepts are logged;
 * - no tap goes in while paused, before the reveal has ended, or after the win; the clock (and the log's 'r') resumes
 *   at the latest with the first tap after a pause or a reload, so a tap is never logged inside a pause.
 */
export class Run {
  readonly board: Board;
  readonly clock: GameClock;
  readonly log: GameLog;
  readonly startEpoch: number;
  readonly revealAt: number;
  readonly interactiveAt: number;
  /**
   * Integer: board time + logOffset = log time. It only grows, and only at a resume with no turn in flight (see
   * resumeIfDue), so the browser's board and the replay's never disagree about when a turn ends.
   */
  private logOffset: number;
  private pausedNow = false;

  constructor(board: Board, s: RunStart) {
    this.board = board;
    this.clock = new GameClock(s.elapsedMs);
    this.log = new GameLog(s.log);
    this.startEpoch = s.startEpoch;
    this.revealAt = s.now;
    this.interactiveAt = s.now + REVEAL_MS;
    // Log time never goes backwards, even if the wall clock did while the page was away.
    this.logOffset = Math.max(Math.round(s.epochNow - s.startEpoch - s.now), this.lastLogT() - Math.round(s.now));
  }

  get paused(): boolean {
    return this.pausedNow;
  }

  /** Log time (integer ms since the tree began) of a performance.now() instant. */
  logNow(now: number): number {
    return Math.round(now) + this.logOffset;
  }

  elapsedMs(now: number): number {
    return this.clock.elapsedMs(now);
  }

  /**
   * Each frame: the clock starts (or resumes) once the reveal is over, and turns due by `now` finish. `epochNow` is
   * Date.now() at the same instant (see resumeIfDue); every entry point that can resume the clock takes it.
   */
  frame(now: number, epochNow?: number): BoardEvent[] {
    const resumed = this.resumeIfDue(now, epochNow);
    return this.won([...resumed, ...this.advance(now)], now);
  }

  /** A tap on tile `i`: refused while paused, before the reveal ends or after the win. Logged only if the board takes it. */
  tap(i: number, now: number, epochNow?: number): BoardEvent[] {
    if (this.pausedNow || now < this.interactiveAt || this.board.won) return [];
    const resumed = this.resumeIfDue(now, epochNow);
    const t = Math.max(this.logNow(now), this.lastLogT());
    const bt = t - this.logOffset;
    const events = [...resumed, ...this.advance(bt)];
    if (this.board.won) return this.won(events, now);
    const tapped = this.board.tap(i, bt);
    if (tapped.length) this.log.tap(t, i);
    return [...events, ...tapped];
  }

  /** The pause pill, P or a hidden tab: the clock stops and the log says so. */
  pause(now: number): void {
    if (this.pausedNow) return;
    this.pausedNow = true;
    this.clock.pause(now);
    this.log.pause(this.logNow(now));
  }

  /** Back from a pause: the clock (and the log) resume now, or when the reveal ends. Returns turns that finished meanwhile. */
  resume(now: number, epochNow?: number): BoardEvent[] {
    this.pausedNow = false;
    return this.won(this.resumeIfDue(now, epochNow), now);
  }

  /**
   * The page is hidden, going away, or just came back from a reload while the clock can't be paused (the reveal): a
   * reload counts as a pause (spec §5.2), so the log pauses here and resumes when the clock does, after the reveal.
   */
  markAway(now: number): void {
    if (!this.board.won) this.log.pause(this.logNow(now));
  }

  /** Finishes turns at their exact finishing times up to `to` (board time), exactly as the replay does. */
  private advance(to: number): BoardEvent[] {
    const out: BoardEvent[] = [];
    this.board.advanceTo(to, out);
    return out;
  }

  /** The clock stops with the win (the frame or tap that sees it). */
  private won(events: BoardEvent[], now: number): BoardEvent[] {
    if (events.some((e) => e.type === 'won')) this.clock.pause(now);
    return events;
  }

  /**
   * The clock resumes (and the log's 'r') once nothing holds it: not paused, past the reveal, not won.
   *
   * performance.now() stops while a phone sleeps, so a pause that spans a sleep would log less time away than really
   * passed, and the server would call the run 'clock'. So first the turns due by now finish (as the replay will do at
   * the 'r'); then, if none is still in flight, log time catches up with the wall clock (`epochNow`), exactly as a
   * reload's would: the extra time lands inside this pause, which the server trusts and caps. With a turn in flight
   * the offset stays, so that turn ends at the same log time here and in the replay.
   */
  private resumeIfDue(now: number, epochNow?: number): BoardEvent[] {
    if (this.pausedNow || this.board.won || this.clock.running || now < this.interactiveAt) return [];
    const events = this.advance(Math.max(this.logNow(now), this.lastLogT()) - this.logOffset);
    if (this.board.won) return events;
    if (epochNow !== undefined && this.board.rotating.size === 0) {
      this.logOffset = Math.max(this.logOffset, Math.round(epochNow - this.startEpoch - now));
    }
    this.clock.resume(now);
    this.log.resume(Math.max(this.logNow(now), this.lastLogT()));
    return events;
  }

  private lastLogT(): number {
    const e = this.log.entries;
    return e.length ? e[e.length - 1].t : 0;
  }
}
