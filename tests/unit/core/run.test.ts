// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Board, MAX_QUEUE, ROTATE_MS } from '../../../src/core/board';
import { REVEAL_MS } from '../../../src/core/clock';
import { rotCW } from '../../../src/core/dirs';
import { judge } from '../../../src/core/judge';
import { GRID } from '../../../src/core/mask';
import { replay } from '../../../src/core/replay';
import { mulberry32, type Rng } from '../../../src/core/rng';
import { Run } from '../../../src/core/run';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { loadGame, saveGame } from '../../../src/store/progress';

beforeEach(() => localStorage.clear());

/**
 * The browser as App drives a Run: performance.now() (fractional, restarting near 0 on a reload) and Date.now() (whole
 * ms, continuous) moving together, a frame every ~16.7 ms (or a late one), taps between frames, the pause pill, a
 * hidden tab, and a reload through aglow.game. Every call here is one App makes (see src/app.ts).
 */
class Page {
  perf: number;
  private epoch: number;
  run: Run;
  private nextFrame: number;
  /** Time as the server sees it (no wall-clock jumps). */
  private realMs = 0;

  constructor(
    readonly seed: number,
    private readonly rng: Rng,
    epoch = 1_760_000_000_000.4,
  ) {
    this.perf = 250 + rng() * 100;
    this.nextFrame = this.perf + rng() * 16;
    this.epoch = epoch;
    const board = seededBoard(seed, GEN_VERSION);
    if (!board) throw new Error('no board');
    // App.freshTree: startEpoch = Date.now() just as the tree begins.
    this.run = new Run(board, { now: this.perf, epochNow: this.dateNow, startEpoch: this.dateNow, elapsedMs: 0, log: [] });
  }

  get dateNow(): number {
    return Math.floor(this.epoch);
  }

  /** Time passes, with a frame (App.loop) every `frameMs` (longer: frames come late). */
  wait(ms: number, frameMs = 16.7): void {
    const end = this.perf + ms;
    while (this.nextFrame <= end) {
      this.step(this.nextFrame - this.perf);
      this.run.frame(this.perf);
      this.nextFrame += frameMs;
    }
    this.step(end - this.perf);
  }

  /** Time passes with no frame at all (a stalled main thread). */
  stall(ms: number): void {
    this.step(ms);
    this.nextFrame = Math.max(this.nextFrame, this.perf + 0.1);
  }

  private step(ms: number): void {
    this.perf += ms;
    this.epoch += ms;
    this.realMs += ms;
  }

  /** App.tapTile, between frames: whether the tap went in (and was logged). */
  tap(i: number): boolean {
    const before = this.run.log.entries.length;
    this.run.tap(i, this.perf);
    return this.run.log.entries.length > before;
  }

  waitInteractive(): void {
    this.wait(Math.max(0, this.run.interactiveAt - this.perf) + this.rng() * 30);
  }

  /** The pause pill or P (App.pause), then the overlay tap (App.resume). */
  pauseFor(ms: number): void {
    this.run.pause(this.perf);
    this.wait(ms);
    this.run.resume(this.perf);
  }

  /** A hidden tab (App's visibilitychange: pause(false) when it can pause), back `ms` later, then the overlay tap. */
  hideTab(ms: number): void {
    if (this.perf >= this.run.interactiveAt) this.run.pause(this.perf);
    this.wait(ms);
    this.run.resume(this.perf);
  }

  /**
   * A reload: pagehide (pause, or the log's pause during the reveal; then the save), `awayMs` with no page, and the
   * restore (App.boot: the saved tree, its log, and the reload logged as a pause).
   */
  reload(awayMs: number, clockJumpMs = 0): void {
    if (this.perf >= this.run.interactiveAt) this.run.pause(this.perf);
    else this.run.markReload(this.perf);
    saveGame(this.run.board, this.run.elapsedMs(this.perf), { startEpoch: this.run.startEpoch, online: null, log: this.run.log.entries, won: null });
    this.epoch += awayMs + clockJumpMs;
    this.realMs += awayMs;
    this.perf = 40 + this.rng() * 200; // a new page: performance.now() starts again
    this.nextFrame = this.perf + this.rng() * 16;
    const saved = loadGame(GRID);
    if (!saved) throw new Error('no save');
    this.run = new Run(new Board(GRID, saved.state), { now: this.perf, epochNow: this.dateNow, startEpoch: saved.startEpoch, elapsedMs: saved.elapsedMs, log: saved.log });
    this.run.markReload(this.perf);
  }

  /** Taps tile i until it settles on its solution, `gap()` ms apart. */
  solveTile(i: number, gap: () => number): void {
    for (let b = this.run.board.settledBits()[i], k = 0; b !== this.run.board.solution[i] && k < 4; b = rotCW(b), k++) {
      expect(this.tap(i)).toBe(true);
      this.wait(gap());
    }
  }

  /** Waits for the last turn to settle and the win (frames, as App.loop). */
  finish(): void {
    for (let k = 0; k < 100 && !this.run.board.won; k++) this.wait(16.7);
    expect(this.run.board.won).toBe(true);
  }

  verdict(latencyMs = 150) {
    return judge({ seed: this.seed, genVersion: GEN_VERSION, log: this.run.log.entries, serverElapsedMs: this.realMs + latencyMs });
  }
}

const ids = GRID.ids;

describe('Run: the browser logs taps exactly as the server replays them', () => {
  it('an honest session with a pause, a hidden tab, a reload mid-game and a reload during the reveal verifies and ranks', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed * 7919);
      const page = new Page(seed, rng);
      const gap = () => 45 + rng() * 140;
      page.waitInteractive();
      const quarter = Math.floor(ids.length / 4);
      for (const i of ids.slice(0, quarter)) page.solveTile(i, gap);
      page.pauseFor(4000);
      for (const i of ids.slice(quarter, 2 * quarter)) page.solveTile(i, gap);
      page.hideTab(9000);
      for (const i of ids.slice(2 * quarter, 3 * quarter)) page.solveTile(i, gap);
      page.reload(2500);
      page.wait(300); // still revealing
      page.reload(1200); // reloaded again during the reveal
      page.waitInteractive();
      for (const i of ids.slice(3 * quarter)) page.solveTile(i, gap);
      page.finish();
      const clockMs = page.run.elapsedMs(page.perf);
      const v = page.verdict();
      expect(v, `seed ${seed}`).not.toBeNull();
      expect(v?.reason, `seed ${seed}`).toBeNull();
      // The second reload came before the clock resumed: one pause for both.
      expect(v?.pauses).toBe(3);
      // The server's ranked time is the clock the player watched (to a frame or two).
      expect(Math.abs((v?.ms ?? 0) - clockMs), `seed ${seed}`).toBeLessThan(50);
    }
  });

  it('turn boundaries: taps landing within a fraction of a ms of a turn finishing, full queues and late frames still verify', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed);
      const page = new Page(seed, rng);
      page.waitInteractive();
      for (let k = 0; k < 60; k++) {
        const i = ids[Math.floor(rng() * ids.length)];
        const burst = 1 + Math.floor(rng() * (MAX_QUEUE + 3)); // past a full queue: some taps are dropped (not logged)
        for (let b = 0; b < burst; b++) {
          page.tap(i);
          // Right around ROTATE_MS (where rounding could flip "still turning?"), or quick, or after a stalled frame.
          const r = rng();
          if (r < 0.5) page.wait(ROTATE_MS - 0.6 + rng() * 1.2, 16.7);
          else if (r < 0.8) page.wait(5 + rng() * 30, 16.7);
          else page.wait(150 + rng() * 400, 260 + rng() * 200);
        }
      }
      for (const i of ids) page.solveTile(i, () => 41 + rng() * 80);
      page.finish();
      const headless = seededBoard(seed, GEN_VERSION, true);
      const r = headless && replay(headless, page.run.log.entries);
      expect(r, `seed ${seed}`).not.toBeNull();
      expect(headless?.bits).toEqual(page.run.board.bits);
    }
  });

  it('no tap goes in (or is logged) before the reveal ends, while paused, or after the win', () => {
    const page = new Page(3, mulberry32(3));
    page.wait(REVEAL_MS - 5);
    expect(page.tap(ids[0])).toBe(false);
    page.waitInteractive();
    expect(page.tap(ids[0])).toBe(true);
    page.run.pause(page.perf);
    page.wait(500);
    expect(page.tap(ids[1])).toBe(false);
    expect(page.run.log.entries.map((e) => e.a)).toEqual([ids[0], 'p']);
    expect(page.run.log.entries[0].t).toBeGreaterThanOrEqual(REVEAL_MS - 50);
    page.run.board.debugSolve();
    expect(page.tap(ids[1])).toBe(false);
  });

  it('a tap after the solve is refused even when no frame has run since (turns finish at their exact times, as in the replay)', () => {
    const rng = mulberry32(7);
    const page = new Page(7, rng);
    page.waitInteractive();
    const settled = page.run.board.settledBits();
    const turns = (i: number) => {
      let k = 0;
      for (let b = settled[i]; b !== page.run.board.solution[i]; b = rotCW(b)) k++;
      return k;
    };
    const lastTile = ids.find((i) => turns(i) >= 2);
    if (lastTile === undefined) throw new Error('no tile needs two turns');
    for (const i of ids) if (i !== lastTile) page.solveTile(i, () => 50);
    page.wait(400);
    page.solveTile(lastTile, () => 10); // the winning turns, queued
    page.stall(1000); // the tab stalls: no frame
    const other = ids.find((i) => i !== lastTile) ?? -1;
    expect(page.tap(other)).toBe(false);
    page.finish();
    expect(page.verdict()).not.toBeNull();
  });

  it('a tap right after a resume, before any frame, comes after the log resumes', () => {
    const page = new Page(4, mulberry32(4));
    page.waitInteractive();
    page.run.pause(page.perf);
    page.wait(1000);
    page.run.resume(page.perf);
    expect(page.tap(ids[2])).toBe(true);
    expect(page.run.log.entries.map((e) => e.a)).toEqual(['p', 'r', ids[2]]);
  });

  it('after a reload, the first tap (even before a frame has run) is logged after the resume, past the reveal', () => {
    const page = new Page(5, mulberry32(5));
    page.waitInteractive();
    page.tap(ids[0]);
    page.wait(200);
    page.reload(3000);
    page.perf = page.run.interactiveAt; // no frame since the restore
    expect(page.tap(ids[1])).toBe(true);
    const log = page.run.log.entries;
    expect(log.map((e) => e.a)).toEqual([ids[0], 'p', 'r', ids[1]]);
    expect(log[3].t - log[1].t).toBeGreaterThanOrEqual(3000 + REVEAL_MS - 1);
  });

  it("the wall clock going back while the page was away never takes the log backwards; the run still verifies", () => {
    const rng = mulberry32(6);
    const page = new Page(6, rng);
    page.waitInteractive();
    const half = Math.floor(ids.length / 2);
    for (const i of ids.slice(0, half)) page.solveTile(i, () => 60);
    page.reload(1000, -60_000);
    page.waitInteractive();
    for (const i of ids.slice(half)) page.solveTile(i, () => 60);
    page.finish();
    const log = page.run.log.entries;
    expect(log.every((e, k) => k === 0 || e.t >= log[k - 1].t)).toBe(true);
    expect(page.verdict(0)).not.toBeNull();
  });
});
