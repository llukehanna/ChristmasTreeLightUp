import type { ReplayResponse } from '../api/types';
import { chimeStep, type Sfx } from '../audio/sfx';
import type { Board, BoardEvent } from '../core/board';
import { REVEAL_MS } from '../core/clock';
import { GRID } from '../core/mask';
import { Playback } from '../core/playback';
import { seededBoard } from '../core/seeded';
import { CONFETTI_MS, LAST_WAVE_SPEEDUP } from '../render/effects';
import { VisualState } from '../render/visual-state';
import { ReplayBar, replayCaption } from '../ui/replay-bar';

/** A run on the stage (C4 decision 3): its own board, playback and lighting, beside the player's tree. */
export interface ReplayRun {
  readonly data: ReplayResponse;
  readonly board: Board;
  readonly playback: Playback;
  readonly vis: VisualState;
  /** When the replay's tree was won (performance.now()), or null. */
  winAt: number | null;
  playing: boolean;
  speed: 1 | 2;
  ended: boolean;
}

export interface ReplayerHooks {
  /** The game's sounds: the replay's ticks and chimes, at the effects volume. */
  readonly sfx: Sfx;
  /** Something is moving until `until`: hold the full frame rate. */
  busy(until: number): void;
  /** A lighting change gets its connection flashes now (as in play: not under reduced motion, nor on filament). */
  flashes(): boolean;
  /** The bar's Done. */
  onDone(): void;
}

/**
 * The playhead has played the run out: the playback says so, or it has reached the solve (should the drawn board somehow
 * not win there, the replay still ends rather than run on silently).
 */
export const playedOut = (p: Playback): boolean => p.ended || (p.solvedAt !== null && p.cursor >= p.solvedAt);

/**
 * Plays runs back on the stage for the app (src/app.ts watch): the run on the stage, its frames, and the replay bar. One
 * for the page, made on the first Watch; it holds a run only while one is being watched. The app draws `run` and keeps
 * the player's own tree aside meanwhile.
 */
export class Replayer {
  /** The run being watched, or null. */
  run: ReplayRun | null = null;
  private readonly bar: ReplayBar;

  constructor(
    host: HTMLElement,
    private readonly hooks: ReplayerHooks,
  ) {
    this.bar = new ReplayBar(host, {
      onToggle: () => this.toggle(),
      onSpeed: () => {
        if (!this.run) return;
        this.run.speed = this.run.speed === 1 ? 2 : 1;
        this.sync();
      },
      onRestart: () => {
        if (this.run) this.start(this.run.data, performance.now(), this.run.speed);
        this.sync();
      },
      onDone: () => hooks.onDone(),
    });
  }

  /** Plays `data` from the start, replacing any run on the stage; false when its tree can't be built here (its generator is unknown). */
  play(data: ReplayResponse, now: number): boolean {
    if (!this.start(data, now, 1)) return false;
    this.bar.show(replayCaption(data));
    return true;
  }

  /** Done: the bar goes, and the run with it. */
  stop(): void {
    this.run = null;
    this.bar.hide();
  }

  /** Pause or Play (the bar, a stage tap, Space or P). A run that has played out stays put: Watch again restarts it. */
  toggle(): void {
    const r = this.run;
    if (!r || r.ended) return;
    r.playing = !r.playing;
    this.hooks.busy(performance.now());
    this.sync();
  }

  /**
   * A key while the run plays: Space and P play and pause (Space on a focused button, the bar's own or the HUD's,
   * presses that button instead). True for Escape, which is Done.
   */
  key(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      e.preventDefault();
      return !e.repeat;
    }
    const onButton = e.target instanceof Element && e.target.closest('button, a[href], [role="button"]') !== null;
    if (e.key === 'p' || e.key === 'P' || (e.key === ' ' && !onButton)) {
      e.preventDefault();
      if (!e.repeat) this.toggle();
    }
    return false;
  }

  /** A frame: the playhead moves by the frame's time at the run's speed, and its events play. */
  frame(now: number, dt: number): void {
    const r = this.run;
    if (!r || !r.playing || r.ended) return;
    this.hooks.busy(now);
    this.events(r, r.playback.step(dt, r.speed), now);
    if (playedOut(r.playback)) {
      r.ended = true;
      r.playing = false;
      this.sync();
    }
  }

  /** A fresh board for the run, its playback at the start, and its lighting as the app's beginGame lights a new tree's. */
  private start(data: ReplayResponse, now: number, speed: 1 | 2): boolean {
    const board = seededBoard(data.seed, data.genVersion);
    if (!board) return false;
    const vis = new VisualState(GRID.w * GRID.h);
    // The source switches on as the reveal finishes and the initial connected region flows out.
    vis.onLightingChanged(board, board.lighting.order, [], now + REVEAL_MS - 200, false);
    this.run = { data, board, playback: new Playback(board, data.log), vis, winAt: null, playing: true, speed, ended: false };
    this.hooks.busy(Math.max(now + REVEAL_MS, vis.lastLitAt(board)));
    return true;
  }

  private sync(): void {
    const r = this.run;
    if (r) this.bar.set({ playing: r.playing, speed: r.speed, ended: r.ended });
  }

  /**
   * The run's board events, as the app's handle() plays a live run's (C4 decision 5): the turn ticks and the lighting
   * chimes, and the win's visuals from winAt. Never a save, stats, the results tag, unlock news or haptics.
   */
  private events(r: ReplayRun, events: readonly BoardEvent[], now: number): void {
    const { sfx } = this.hooks;
    for (const e of events) {
      switch (e.type) {
        case 'rotateStarted':
        case 'tapBuffered':
          this.hooks.busy(now + r.board.rotateMs);
          sfx.tick();
          break;
        case 'rotateFinished':
          r.vis.onRotateFinished(r.board, e.tile, now);
          break;
        case 'lightingChanged': {
          const pops = r.vis.onLightingChanged(r.board, e.newlyLit, e.lost, now, this.hooks.flashes());
          this.hooks.busy(Math.max(now, r.vis.lastLitAt(r.board)));
          if (e.newlyLit.length) {
            // Pitch follows height, as in play.
            const chimes = pops.map((p) => ({ delayMs: p.at - now, step: chimeStep(Math.floor(p.tile / GRID.w), GRID.h) }));
            sfx.wave(e.newlyLit.length, chimes);
          }
          break;
        }
        case 'won':
          r.winAt = now;
          this.hooks.busy(now + CONFETTI_MS);
          // As a live win lands: the light still travelling hurries along, its chimes too.
          r.vis.hurry(now, LAST_WAVE_SPEEDUP);
          sfx.hurryChimes(LAST_WAVE_SPEEDUP);
          break;
      }
    }
  }
}
