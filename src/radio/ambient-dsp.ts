import type { Rng } from '../core/rng';

/**
 * The pure part of the procedural ambiences: random helpers and the offline DSP that bakes noise into buffers. No DOM
 * and no audio types, so a worker can render with it (ambient-worker.ts).
 */

/**
 * The rate everything is rendered at, whatever the context runs at: the noise is made before the context exists (it is
 * created inside the first gesture), so it cannot know the context's rate. Each AudioBuffer says its own rate and the
 * source node that plays it resamples, so a 44.1 kHz context hears the same noise.
 */
export const AMBIENT_RATE = 48000;

/** A set of buffers as raw samples: one entry per buffer, each a list of channels. */
export type Pcm = Float32Array[][];

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

/** Two partly correlated noise channels: wide, but still one source in front of you (`corr` 0 = unrelated). */
export function stereoNoise(len: number, rng: Rng, kind: (len: number, rng: Rng) => Float32Array<ArrayBuffer>, corr: number): Float32Array[] {
  const l = kind(len, rng);
  const b = kind(len, rng);
  const k = Math.sqrt(1 - corr * corr);
  const r = new Float32Array(len);
  for (let i = 0; i < len; i++) r[i] = corr * l[i] + k * b[i];
  return [l, r];
}
