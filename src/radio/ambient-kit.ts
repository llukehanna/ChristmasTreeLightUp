import type { Rng } from '../core/rng';

/**
 * Shared parts of the procedural ambiences (Fireplace, Rain, Storm): a look-ahead scheduler on the audio clock,
 * loopable noise, buffer pools rendered once per context, and a tiny offline biquad for baking resonances into those
 * pools (so an event costs one or two nodes instead of a filter chain).
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

  constructor(protected readonly rng: Rng = Math.random) {}

  get running(): boolean {
    return this.gain !== null;
  }

  start(ctx: Ctx, out: AudioNode): void {
    if (this.gain) return;
    this.ctx = ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN_S);
    g.connect(out);
    this.gain = g;
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

/** Exponential gap for a Poisson process of `rate` events per second. */
export const poisson = (rng: Rng, rate: number): number => -Math.log(1 - rng()) / Math.max(1e-6, rate);
export const between = (rng: Rng, a: number, b: number): number => a + (b - a) * rng();
/** Log-uniform: as many quiet events per octave as loud ones. */
export const logBetween = (rng: Rng, a: number, b: number): number => a * (b / a) ** rng();
export const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

/* ---------- offline DSP for baking buffers ---------- */

/** RBJ biquad, direct form I, for rendering pools and loops in JS (never per audio frame). */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  static bandpass(f: number, q: number, fs: number): Biquad {
    const w = (2 * Math.PI * Math.min(f, fs * 0.45)) / fs;
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    return new Biquad(al / a0, 0, -al / a0, (-2 * Math.cos(w)) / a0, (1 - al) / a0);
  }
  static lowpass(f: number, q: number, fs: number): Biquad {
    const w = (2 * Math.PI * Math.min(f, fs * 0.45)) / fs;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al;
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  }
  static highpass(f: number, q: number, fs: number): Biquad {
    const w = (2 * Math.PI * f) / fs;
    const al = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + al;
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  /** Filters `d` in place. */
  run(d: Float32Array): Float32Array {
    for (let i = 0; i < d.length; i++) d[i] = this.step(d[i]);
    return d;
  }
  /**
   * Filters a loop in place so it stays seamless: one warm-up pass over the loop settles the filter into its periodic
   * state, then the second pass is written. The wrap-around then joins with no step.
   */
  runLoop(d: Float32Array): Float32Array {
    for (let i = 0; i < d.length; i++) this.step(d[i]);
    return this.run(d);
  }
}

/** Pink (-3 dB/octave) noise, seamless as a loop (Paul Kellet's filter, run with a warm-up pass). */
export function pinkLoop(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const w = new Float32Array(len);
  for (let i = 0; i < len; i++) w[i] = rng() * 2 - 1;
  const out = new Float32Array(len);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < len; i++) {
      const x = w[i];
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
    }
  }
  return out;
}

/** Brown (-6 dB/octave) noise, seamless as a loop: a leaky integrator run with a warm-up pass. */
export function brownLoop(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const w = new Float32Array(len);
  for (let i = 0; i < len; i++) w[i] = rng() * 2 - 1;
  const out = new Float32Array(len);
  let last = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * w[i]) / 1.02;
      out[i] = last * 3.5;
    }
  }
  return out;
}

/** A smooth random control signal in [-1, 1] (cosine-interpolated points `stepS` apart), seamless as a loop. */
export function smoothRandomLoop(len: number, fs: number, stepS: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.round(len / (stepS * fs)));
  const pts = Array.from({ length: n }, () => rng() * 2 - 1);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i / len) * n;
    const k = Math.floor(x);
    const f = (1 - Math.cos((x - k) * Math.PI)) / 2;
    out[i] = pts[k % n] * (1 - f) + pts[(k + 1) % n] * f;
  }
  return out;
}

/** Peak-normalise to `peak`, with a short fade at the end so a truncated tail never clicks. */
export function finish(d: Float32Array, peak = 1, fadeSamples = 64): Float32Array<ArrayBuffer> {
  let m = 0;
  for (const v of d) m = Math.max(m, Math.abs(v));
  const k = m > 0 ? peak / m : 0;
  const n = Math.min(fadeSamples, d.length);
  for (let i = 0; i < d.length; i++) {
    const fade = i >= d.length - n ? (d.length - i) / n : 1;
    d[i] *= k * fade;
  }
  return d as Float32Array<ArrayBuffer>;
}

/* ---------- buffers, rendered once per context ---------- */

const cache = new WeakMap<Ctx, Map<string, AudioBuffer[]>>();

/** Buffers made by `make` once per context and kept: a second start (or another ambience) reuses them. */
export function cached(ctx: Ctx, key: string, make: () => AudioBuffer[]): AudioBuffer[] {
  let m = cache.get(ctx);
  if (!m) cache.set(ctx, (m = new Map()));
  let b = m.get(key);
  if (!b) m.set(key, (b = make()));
  return b;
}

export function toBuffer(ctx: Ctx, channels: readonly Float32Array[]): AudioBuffer {
  const b = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

/** Two partly correlated noise channels: wide, but still one source in front of you (`corr` 0 = unrelated). */
export function stereoNoise(len: number, rng: Rng, kind: (len: number, rng: Rng) => Float32Array<ArrayBuffer>, corr: number): Float32Array[] {
  const l = kind(len, rng);
  const b = kind(len, rng);
  const k = Math.sqrt(1 - corr * corr);
  const r = new Float32Array(len);
  for (let i = 0; i < len; i++) r[i] = corr * l[i] + k * b[i];
  return [l, r];
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
