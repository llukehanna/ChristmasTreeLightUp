import type { Rng } from '../core/rng';
import { AMBIENT_RATE, type Pcm } from './ambient-dsp';
import { RECIPES, type RenderReply, type RenderRequest } from './ambient-recipes';

export * from './ambient-dsp';

/**
 * Shared parts of the procedural ambiences (Fireplace, Rain, Storm): a look-ahead scheduler on the audio clock,
 * buffer pools rendered once (in a worker, before there is an audio context) and wrapped per context, and the pure
 * DSP for baking them (ambient-dsp.ts, re-exported here).
 */

export type Ctx = BaseAudioContext;

const TICK_MS = 250;
/**
 * Events are laid down this far ahead on the audio clock, so a late timer tick never leaves a gap: more than the 1 s
 * timer clamp of a hidden tab. stop() still silences everything at once through the output gain.
 */
export const LOOKAHEAD_S = 1.5;
const FADE_IN_S = 1.5;
const FADE_OUT_S = 0.5;

/** Endless procedural ambience: continuous beds built once in `build`, one-shot events laid down by `schedule`. */
export abstract class AmbientSynth {
  private timer = 0;
  private gain: GainNode | null = null;
  private ctx: Ctx | null = null;
  private beds: AudioScheduledSourceNode[] = [];
  /** Long one-shots (thunder) still sounding: stopped with the beds. */
  private readonly long = new Set<AudioScheduledSourceNode>();
  private cursor = 0;
  /** A start waiting for the worker's noise (the token tells a cancelled wait from the current one). */
  private waiting: object | null = null;
  /** Cancels the wait for the tab to be visible, once the noise has come. */
  private unhide: (() => void) | null = null;

  constructor(protected readonly rng: Rng = Math.random) {}

  /** Sounding, or about to: waiting for its noise. */
  get running(): boolean {
    return this.gain !== null || this.waiting !== null;
  }

  /**
   * Starts the ambience. Where a worker renders the noise, a start that finds some missing never renders it here: it
   * waits for the worker (a second or so at worst) and fades in when it arrives, in a visible tab. If the worker
   * fails, it renders what is missing here, as it does where there is no worker. stop() cancels a wait.
   */
  start(ctx: Ctx, out: AudioNode): void {
    if (this.running) return;
    const missing = this.recipes().filter((r) => !r.ready());
    if (!missing.length || !offThread()) return this.begin(ctx, out);
    const token = {};
    this.waiting = token;
    this.ctx = ctx;
    void Promise.all(missing.map((r) => r.ask()))
      .catch(() => undefined)
      .then(() => {
        if (this.waiting !== token) return;
        this.unhide = whenVisible(() => {
          this.unhide = null;
          this.waiting = null;
          this.begin(ctx, out);
        });
      });
  }

  private begin(ctx: Ctx, out: AudioNode): void {
    if (this.gain) return;
    this.ctx = ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN_S);
    g.connect(out);
    this.gain = g;
    // Whatever prewarm hasn't made yet is made now, in the same order, so the noise is the same either way.
    for (const r of this.recipes()) r.render();
    this.beds = this.build(ctx, g);
    for (const s of this.beds) {
      const b = (s as Partial<AudioBufferSourceNode>).buffer;
      if (b) (s as AudioBufferSourceNode).start(ctx.currentTime, this.rng() * b.duration);
      else s.start(ctx.currentTime);
    }
    this.cursor = 0;
    this.timer = window.setInterval(() => this.pump(), TICK_MS);
    this.pump();
  }

  /** `ctx` is optional: the context given to `start` is remembered. */
  stop(ctx?: Ctx | null): void {
    this.waiting = null;
    this.unhide?.();
    this.unhide = null;
    window.clearInterval(this.timer);
    const c = ctx ?? this.ctx;
    const g = this.gain;
    const sources = [...this.beds, ...this.long];
    this.gain = null;
    this.beds = [];
    this.long.clear();
    this.ctx = null;
    if (!g) return;
    this.teardown();
    if (c) {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + FADE_OUT_S);
    }
    window.setTimeout(() => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      g.disconnect();
    }, FADE_OUT_S * 1000 + 100);
  }

  /** Asks the worker for every set, in order (the remembered ambience's first): nothing runs on this thread. */
  warm(): void {
    for (const r of this.recipes()) r.ask().catch(() => undefined);
  }

  /**
   * Renders the noise on this thread (where there is no worker) ahead of the first start, one recipe per idle slice (`idle` schedules a slice), so a
   * start never stalls on noise generation. It needs no audio context (there is none before the first gesture). A
   * set already made (by an earlier slice, a start or another ambience sharing it) is skipped. A start halfway
   * through just makes the rest.
   */
  async prewarm(idle: (fn: () => void) => void): Promise<void> {
    for (const r of this.recipes()) {
      await new Promise<void>((done, fail) =>
        idle(() => {
          try {
            r.render();
            done();
          } catch (e) {
            fail(e);
          }
        }),
      );
    }
  }

  /** One recipe per set of buffers this ambience uses, in the order `build` first reads them. */
  protected abstract recipes(): ReadonlyArray<Recipe>;
  /** Continuous layers, connected to `out` and not yet started (start() starts them). */
  protected abstract build(ctx: Ctx, out: AudioNode): AudioScheduledSourceNode[];
  /** Lay down every event in [from, to) on the audio clock. Called with contiguous windows. */
  protected abstract schedule(ctx: Ctx, from: number, to: number): void;
  /** Drop per-run state when stopped. */
  protected teardown(): void {}

  /** A one-shot that outlasts the look-ahead: remembered so stop() can cut it. */
  protected keep(src: AudioScheduledSourceNode): void {
    this.long.add(src);
    src.onended = () => this.long.delete(src);
  }

  /** Look-ahead scheduler: lay down the next window, skipping while the context is suspended. */
  private pump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    if (ctx.state !== 'running') {
      this.cursor = 0; // after an iOS interruption, restart from "now" instead of piling up old events
      return;
    }
    const now = ctx.currentTime;
    if (this.cursor < now) this.cursor = now;
    const until = now + LOOKAHEAD_S;
    if (this.cursor >= until) return;
    this.schedule(ctx, this.cursor, until);
    this.cursor = until;
  }
}

/**
 * A random event stream: `gap()` gives the next interval (it may read the current intensity), `fire(t)` lays one
 * event down. After a suspension the stream restarts from the window instead of firing a backlog.
 */
export class Stream {
  next: number;
  constructor(
    private readonly gap: () => number,
    private readonly fire: (t: number) => void,
    first = 0,
  ) {
    this.next = first;
  }
  run(from: number, to: number): void {
    if (this.next < from - 0.05) this.next = from + this.gap() * Math.random();
    while (this.next < to) {
      this.fire(Math.max(from, this.next));
      this.next += Math.max(0.002, this.gap());
    }
  }
}

/* ---------- buffers: rendered once (off the main thread when it can), wrapped per context ---------- */

const rendered = new Map<string, Pcm>();
const wrapped = new WeakMap<Ctx, Map<string, AudioBuffer[]>>();

/** The key of every set rendered so far, in the order they arrived (what the tests count). */
export const renderedKeys = (): string[] => [...rendered.keys()];

/** A set waiting on the worker: settled when its samples arrive. */
const waiters = new Map<string, { promise: Promise<void>; done: () => void; fail: (e: Error) => void }>();
/** The renderer: undefined until first asked, null where there is none (no Worker, or it failed). */
let worker: Worker | null | undefined;

/** Forgets every rendered set and the worker (tests). */
export function clearRendered(): void {
  rendered.clear();
  for (const w of waiters.values()) w.fail(new Error('cleared'));
  waiters.clear();
  worker?.terminate();
  worker = undefined;
}

/** Whether sets can be rendered off the main thread: a Worker exists and has not failed. */
export const offThread = (): boolean => typeof Worker !== 'undefined' && worker !== null;

function renderWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL('./ambient-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<RenderReply>) => {
      const { key, pcm } = e.data;
      if (!rendered.has(key)) rendered.set(key, pcm);
      waiters.get(key)?.done();
      waiters.delete(key);
    };
    // A failed worker is given up on: whoever waits falls back to rendering here, and nothing asks it again.
    w.onerror = () => {
      worker = null;
      w.terminate();
      for (const x of waiters.values()) x.fail(new Error('the ambient worker failed'));
      waiters.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Asks the worker for `key` (once: a second ask shares the first). Rejects where there is no worker or it fails. */
function ask(key: string): Promise<void> {
  if (rendered.has(key)) return Promise.resolve();
  const pending = waiters.get(key);
  if (pending) return pending.promise;
  const w = renderWorker();
  if (!w) return Promise.reject(new Error('no worker'));
  let done!: () => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<void>((a, b) => ((done = a), (fail = b)));
  waiters.set(key, { promise, done, fail });
  const request: RenderRequest = { key, seed: Math.floor(Math.random() * 2 ** 32) };
  w.postMessage(request);
  return promise;
}

/**
 * One named set of buffers (a key of RECIPES). It is rendered once and shared by every ambience and context:
 * `ask()` has the worker do it (nothing on this thread); `render()` does it here, with `rng`, if nobody has yet (the
 * fallback, and what start() makes of whatever the worker hasn't delivered). `on(ctx)` wraps the samples as
 * AudioBuffers once per context, which is a copy and no more.
 */
export interface Recipe {
  readonly key: string;
  ready(): boolean;
  ask(): Promise<void>;
  render(): Pcm;
  on(ctx: Ctx): AudioBuffer[];
}

export function recipe(key: string, rng: Rng): Recipe {
  const render = (): Pcm => {
    let pcm = rendered.get(key);
    if (!pcm) rendered.set(key, (pcm = RECIPES[key](rng)));
    return pcm;
  };
  return {
    key,
    ready: () => rendered.has(key),
    ask: () => ask(key),
    render,
    on(ctx) {
      let m = wrapped.get(ctx);
      if (!m) wrapped.set(ctx, (m = new Map()));
      let b = m.get(key);
      if (!b) m.set(key, (b = render().map((channels) => toBuffer(ctx, channels))));
      return b;
    },
  };
}

function toBuffer(ctx: Ctx, channels: readonly Float32Array[]): AudioBuffer {
  const b = ctx.createBuffer(channels.length, channels[0].length, AMBIENT_RATE);
  channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

/** Runs `fn` now if the tab is visible, else when it next is. Returns a cancel. */
export function whenVisible(fn: () => void): () => void {
  if (document.visibilityState !== 'hidden') {
    fn();
    return () => undefined;
  }
  const back = (): void => {
    if (document.visibilityState === 'hidden') return;
    document.removeEventListener('visibilitychange', back);
    fn();
  };
  document.addEventListener('visibilitychange', back);
  return () => document.removeEventListener('visibilitychange', back);
}

/* ---------- live graph helpers ---------- */

/** A looping bed (start() begins it at a random point, so each run sounds different from the first second). */
export function loop(ctx: Ctx, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  return s;
}

export function filter(ctx: Ctx, type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

export function gainNode(ctx: Ctx, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** Fixed stereo positions that one-shots are routed through, so an event never needs its own panner. */
export function panBuses(ctx: Ctx, out: AudioNode, positions: readonly number[]): AudioNode[] {
  return positions.map((p) => {
    const s = ctx.createStereoPanner();
    s.pan.value = p;
    s.connect(out);
    return s;
  });
}

/** One pooled buffer played once: a source and a gain, the only per-event nodes. */
export function shot(ctx: Ctx, buffer: AudioBuffer, when: number, level: number, rate: number, out: AudioNode): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = level;
  s.connect(g).connect(out);
  s.start(when);
  return s;
}
