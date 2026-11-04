import type { Scene } from './scenes';

/**
 * The sky sweep (spec 2026-10-08 secret mode §2.4) and Home Alone's cross-fade (spec 2026-10-14 §1): the backdrop canvas
 * on screen and the one being left. In the main chunk (every scene change goes through it); the aurora's curtains that
 * the sweep brings in are an egg (src/render/aurora.ts, loaded on first use).
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const SWEEP_MS = 1200;
/** Reduced motion: a crossfade instead of the sweep. */
export const SWEEP_FADE_MS = 300;
/** Home Alone's cross-fade (spec 2026-10-14 §1). */
export const FADE_MS = 800;

/** How a scene change arrives: the head's sweep (the default), or Home Alone's cross-fade. */
export interface SceneChange {
  now: number;
  reduced: boolean;
  kind?: 'sweep' | 'fade';
}

export interface SweepFrame {
  /** How much of the height (from the top) shows the aurora, 0..1. */
  cover: number;
  /** The aurora's opacity there (a crossfade under reduced motion). */
  alpha: number;
  /** The seam's glow at the sweep's edge, 0..1. */
  edge: number;
  done: boolean;
}

/** The sweep `t` ms in (negative: not started yet). `down` brings the aurora in, `up` takes it away. */
export function sweepFrame(t: number, dir: 'down' | 'up', reduced: boolean, out: SweepFrame = { cover: 0, alpha: 1, edge: 0, done: false }): SweepFrame {
  if (reduced) {
    const k = clamp01(t / SWEEP_FADE_MS);
    out.cover = 1;
    out.alpha = dir === 'down' ? k : 1 - k;
    out.edge = 0;
    out.done = t >= SWEEP_FADE_MS;
    return out;
  }
  const k = clamp01(t / SWEEP_MS);
  const e = easeInOutCubic(k);
  out.cover = dir === 'down' ? e : 1 - e;
  out.alpha = 1;
  out.edge = k < 1 ? Math.sin(Math.PI * k) : 0; // sin(π) is 1e-16, not 0
  out.done = t >= SWEEP_MS;
  return out;
}

/** The cross-fade `t` ms in: the arriving backdrop over the whole sky at `alpha`, no seam. */
export function fadeFrame(t: number, out: SweepFrame = { cover: 1, alpha: 0, edge: 0, done: false }): SweepFrame {
  out.cover = 1;
  out.alpha = clamp01(t / FADE_MS);
  out.edge = 0;
  out.done = t >= FADE_MS;
  return out;
}

/** The sweep (or fade) under way: the backdrop it leaves (`from`, of `fromScene`), when it starts, and which way. */
export interface SweepRun {
  from: HTMLCanvasElement;
  fromScene: Scene;
  at: number;
  dir: 'down' | 'up';
  reduced: boolean;
  /** The head's sweep, or Home Alone's cross-fade (whole sky, no seam). */
  kind: 'sweep' | 'fade';
}

/**
 * The sky sweep's bookkeeping (spec §2.4): the backdrop canvas on screen, the one being left during a sweep, and one
 * spare canvas reused sweep after sweep. A second crossing toggle mid-sweep reverses it from where it stands.
 */
export class SkySweep {
  /** The backdrop of the current scene (the arriving one during a sweep). */
  bg = document.createElement('canvas');
  private run: SweepRun | null = null;
  /** The last sweep's `from`, emptied: the next sweep's canvas. */
  private spare: HTMLCanvasElement | null = null;
  private readonly out: SweepFrame = { cover: 0, alpha: 1, edge: 0, done: false };
  /** The last frame's clock, for a reversal's mirror. */
  private lastNow = 0;

  get current(): Readonly<SweepRun> | null {
    return this.run;
  }

  /**
   * The scene is changing from `from` to `to`; the caller repaints `bg` after. A sweep runs only with `sweep`, a sized
   * stage and a change into or out of the aurora; a fade (`kind: 'fade'`) with any change of scene, on a sized stage,
   * not under reduced motion (the house arrives at once). A second fade mid-fade (kevin again) reverses it from where it
   * stands, as a second sweep mid-sweep does; the head's sweep mid-fade (hohoho) bakes the fade as it stands into the
   * leaving backdrop and sweeps from that. Any other change ends a sweep or fade under way.
   */
  change(from: Scene, to: Scene, sweep: SceneChange | null, sized: boolean): void {
    const fade = sweep?.kind === 'fade';
    const crossing = fade ? from !== to : (to.id === 'aurora') !== (from.id === 'aurora');
    const dir = to.id === 'aurora' ? 'down' : 'up';
    const run = this.run;
    if (run && sweep && fade && run.kind === 'fade' && crossing && sized && !sweep.reduced) {
      // Reverse the fade: the leaving backdrop becomes the arriving one (the caller repaints it), and the clock is set so
      // the arriving alpha starts at 1 − the alpha it had (a linear fade), so nothing jumps.
      const a = clamp01((this.lastNow - run.at) / FADE_MS);
      const arriving = run.from;
      run.from = this.bg;
      run.fromScene = from;
      this.bg = arriving;
      run.at = this.lastNow - (1 - a) * FADE_MS;
      return;
    }
    if (run && sweep && !fade && run.kind === 'fade' && crossing && sized) {
      // The head mid-fade: the sky as it stands (the arriving backdrop at its alpha over the leaving one) becomes the
      // sweep's leaving backdrop, owned by whichever side showed more; the caller repaints `bg` as the aurora's.
      const a = clamp01((this.lastNow - run.at) / FADE_MS);
      const c = run.from.getContext('2d');
      if (c) {
        c.globalAlpha = a;
        c.drawImage(this.bg, 0, 0);
        c.globalAlpha = 1;
      }
      if (a >= 0.5) run.fromScene = from;
      run.at = sweep.now;
      run.dir = dir;
      run.reduced = sweep.reduced;
      run.kind = 'sweep';
      return;
    }
    if (run && sweep && !fade && run.kind === 'sweep' && crossing && sized) {
      // Reverse: the leaving backdrop becomes the arriving one, and the clock is mirrored so the cover doesn't jump
      // (easeInOutCubic is symmetric: 1 − e(1 − k) = e(k)).
      const k = clamp01((this.lastNow - run.at) / (run.reduced ? SWEEP_FADE_MS : SWEEP_MS));
      const arriving = run.from;
      run.from = this.bg;
      run.fromScene = from;
      this.bg = arriving;
      run.at = this.lastNow - (1 - k) * (sweep.reduced ? SWEEP_FADE_MS : SWEEP_MS);
      run.dir = dir;
      run.reduced = sweep.reduced;
      return;
    }
    this.end();
    // Reduced motion: the house arrives at once (the head's sweep keeps its own 300 ms crossfade).
    if (!sweep || !crossing || !sized || (fade && sweep.reduced)) return;
    const old = this.bg;
    this.bg = this.spare ?? document.createElement('canvas');
    this.spare = null;
    this.bg.width = old.width;
    this.bg.height = old.height;
    this.run = { from: old, fromScene: from, at: sweep.now, dir, reduced: sweep.reduced, kind: fade ? 'fade' : 'sweep' };
  }

  /** This frame's sweep (the shared `out`), or null: none, or it has just finished (and is ended). */
  frame(now: number): SweepFrame | null {
    this.lastNow = now;
    const run = this.run;
    if (!run) return null;
    const fr = run.kind === 'fade' ? fadeFrame(now - run.at, this.out) : sweepFrame(now - run.at, run.dir, run.reduced, this.out);
    if (!fr.done) return fr;
    this.end();
    return null;
  }

  /** Ends a sweep under way (a resize, another scene): the target sky shows at once. */
  end(): void {
    if (!this.run) return;
    const c = this.run.from;
    c.width = c.height = 0; // frees its pixels; the next sweep sizes it again
    this.spare = c;
    this.run = null;
  }
}
