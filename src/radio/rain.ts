import type { Rng } from '../core/rng';
import {
  AmbientSynth,
  between,
  Biquad,
  brownLoop,
  cached,
  type Ctx,
  filter,
  finish,
  gainNode,
  logBetween,
  loop,
  panBuses,
  pick,
  pinkLoop,
  poisson,
  shot,
  stereoNoise,
  Stream,
  toBuffer,
} from './ambient-kit';
import { strike } from './fireplace';

/** How hard it rains: Rain is steady, Storm pours. */
export interface RainLevel {
  /** Soft broadband wash (pink noise, 180 Hz – ~4 kHz). */
  wash: number;
  /** The low drum on the roof (brown noise under 450 Hz). */
  roof: number;
  /** The baked patter loops: a fine sizzle of tiny impacts and a sparser layer of drops on the glass. */
  fine: number;
  drops: number;
  /** Scheduled taps on the window per second, and bigger plops on the sill. */
  tapRate: number;
  plopRate: number;
  tapLevel: number;
  /** A gutter dripping outside, on and off. */
  gutter: boolean;
}

export const LIGHT: RainLevel = { wash: 0.15, roof: 0.13, fine: 0.07, drops: 0.09, tapRate: 9, plopRate: 0.7, tapLevel: 0.14, gutter: true };
export const HEAVY: RainLevel = { wash: 0.14, roof: 0.14, fine: 0.07, drops: 0.09, tapRate: 15, plopRate: 1.8, tapLevel: 0.13, gutter: false };

/**
 * Rain heard from inside a warm room: layered noise for the wash and the roof, two pre-baked loops of hundreds of
 * tiny impacts a second (so the density costs no nodes), and individual taps on the glass scheduled on top, all
 * breathing with a slowly wandering intensity. A gutter drips now and then. Used by Rain and (heavier) by Storm.
 */
export class RainBed {
  private pans: AudioNode[] = [];
  private pools: { tap: AudioBuffer[]; plop: AudioBuffer[]; drip: AudioBuffer[] } | null = null;
  private wash: GainNode | null = null;
  private washLp: BiquadFilterNode | null = null;
  private roof: GainNode | null = null;
  private fine: GainNode | null = null;
  private drops: GainNode | null = null;
  private streams: Stream[] = [];
  /** How hard it is raining right now (≈0.6–1.4), easing toward `target`. */
  private intensity = 1;
  private target = 1;
  private gutter = { on: false, until: 0, period: 1, buf: null as AudioBuffer | null, at: 0, level: 0 };

  constructor(
    private readonly rng: Rng,
    private readonly lvl: RainLevel,
  ) {}

  /** One thunk per buffer set, in the order `build` reads them (AmbientSynth.buffers). */
  buffers(ctx: Ctx): ReadonlyArray<() => void> {
    const p = this.poolMakers(ctx);
    return [() => rainBeds(ctx, this.rng), () => this.patter(ctx), p.tap, p.plop, p.drip];
  }

  build(ctx: Ctx, out: AudioNode): AudioScheduledSourceNode[] {
    const r = this.rng;
    const [washBuf, roofBuf] = rainBeds(ctx, r);
    const [fineBuf, dropsBuf] = this.patter(ctx);

    const wash = loop(ctx, washBuf);
    const washLp = filter(ctx, 'lowpass', 2900, 0.5);
    this.wash = gainNode(ctx, this.lvl.wash);
    wash.connect(filter(ctx, 'highpass', 180, 0.6)).connect(washLp).connect(this.wash).connect(out);
    this.washLp = washLp;

    const roof = loop(ctx, roofBuf);
    this.roof = gainNode(ctx, this.lvl.roof);
    roof.connect(filter(ctx, 'highpass', 60, 0.6)).connect(filter(ctx, 'lowpass', 450, 0.6)).connect(this.roof).connect(out);

    const fine = loop(ctx, fineBuf);
    this.fine = gainNode(ctx, this.lvl.fine);
    fine.connect(this.fine).connect(out);
    const drops = loop(ctx, dropsBuf);
    this.drops = gainNode(ctx, this.lvl.drops);
    drops.connect(this.drops).connect(out);

    const bus = gainNode(ctx, 1);
    bus.connect(filter(ctx, 'lowpass', 6500, 0.6)).connect(out);
    this.pans = panBuses(ctx, bus, [-0.8, -0.4, 0, 0.4, 0.8]);
    const p = this.poolMakers(ctx);
    this.pools = { tap: p.tap(), plop: p.plop(), drip: p.drip() };

    const t0 = ctx.currentTime;
    this.intensity = 1;
    this.target = logBetween(r, 0.7, 1.3);
    this.gutter.on = false;
    this.gutter.until = t0 + between(r, 4, 15);
    this.streams = [
      new Stream(() => 0.5, () => this.wander(), t0),
      new Stream(() => between(r, 1.8, 4), (t) => this.swell(t), t0),
      new Stream(() => poisson(r, this.lvl.tapRate * this.intensity), (t) => this.tap(ctx, t)),
      new Stream(() => poisson(r, this.lvl.plopRate * this.intensity), (t) => this.plop(ctx, t)),
      ...(this.lvl.gutter ? [new Stream(() => (this.gutter.on ? this.gutter.period * between(r, 0.85, 1.15) : 1), (t) => this.drip(ctx, t), t0)] : []),
    ];
    return [wash, roof, fine, drops];
  }

  schedule(from: number, to: number): void {
    for (const s of this.streams) s.run(from, to);
  }

  teardown(): void {
    this.pools = null;
    this.pans = [];
    this.streams = [];
    this.wash = this.roof = this.fine = this.drops = null;
    this.washLp = null;
  }

  /** The two loops of tiny impacts (fine patter and fatter drops), denser for the heavy rain: one set per level. */
  private patter(ctx: Ctx): AudioBuffer[] {
    const r = this.rng;
    const fs = ctx.sampleRate;
    const heavy = this.lvl === HEAVY;
    return cached(ctx, heavy ? 'rain:patter-heavy' : 'rain:patter', () => [
      toBuffer(ctx, patterLoop(fs, 7.3, heavy ? 650 : 420, r, [1500, 5000], [0.4, 1.4])),
      toBuffer(ctx, patterLoop(fs, 11.9, heavy ? 90 : 55, r, [900, 3500], [1, 4])),
    ]);
  }

  /** Each one-shot pool, made (once per context, shared by both levels) when its function is called. */
  private poolMakers(ctx: Ctx): Record<keyof NonNullable<RainBed['pools']>, () => AudioBuffer[]> {
    const fs = ctx.sampleRate;
    const r = this.rng;
    const pool = (key: string, n: number, make: () => Float32Array) => () => cached(ctx, key, () => Array.from({ length: n }, () => toBuffer(ctx, [make()])));
    return {
      tap: pool('rain:tap', 24, () => {
        const f = logBetween(r, 1500, 4500);
        const q = logBetween(r, 5, 16);
        return strike(fs, r, { burstMs: between(r, 0.2, 0.8), modes: [[f, q, 1], [f * between(r, 1.3, 2.1), q * 0.8, between(r, 0.2, 0.5)]], click: 0.5, lp: 6500, maxMs: 50 });
      }),
      plop: pool('rain:plop', 8, () => {
        const f = logBetween(r, 500, 1300);
        return strike(fs, r, { burstMs: between(r, 0.8, 2.5), modes: [[f, between(r, 3, 6), 1], [f * between(r, 2, 2.6), 6, 0.4]], click: 0.3, lp: 4000, maxMs: 80 });
      }),
      drip: pool('rain:drip', 6, () => gutterDrip(fs, r)),
    };
  }

  /** Showers come and go: a new target every 15–40 s on average, eased into over ~10 s. */
  private wander(): void {
    const r = this.rng;
    if (r() < 0.025) this.target = logBetween(r, 0.6, 1.4);
    this.intensity += (this.target - this.intensity) * 0.05;
  }

  /** The beds follow the intensity, with a little life of their own. */
  private swell(t: number): void {
    const r = this.rng;
    const i = this.intensity;
    const tc = between(r, 0.8, 2);
    this.wash?.gain.setTargetAtTime(this.lvl.wash * (0.55 + 0.45 * i) * between(r, 0.9, 1.1), t, tc);
    this.washLp?.frequency.setTargetAtTime((1700 + 1200 * i) * between(r, 0.85, 1.15), t, tc);
    this.roof?.gain.setTargetAtTime(this.lvl.roof * (0.5 + 0.5 * i) * between(r, 0.85, 1.15), t, tc);
    this.fine?.gain.setTargetAtTime(this.lvl.fine * i ** 0.8 * between(r, 0.9, 1.1), t, tc);
    this.drops?.gain.setTargetAtTime(this.lvl.drops * i * between(r, 0.85, 1.15), t, tc);
  }

  /** Wide across the window, but most taps nearer the middle. */
  private spot(): number {
    const r = this.rng;
    return Math.min(4, Math.max(0, Math.round(2 + (r() + r() - 1) * 3)));
  }

  private tap(ctx: Ctx, t: number): void {
    if (!this.pools) return;
    const r = this.rng;
    shot(ctx, pick(r, this.pools.tap), t, this.lvl.tapLevel * logBetween(r, 0.15, 1), between(r, 0.8, 1.25), this.pans[this.spot()]);
  }

  private plop(ctx: Ctx, t: number): void {
    if (!this.pools) return;
    const r = this.rng;
    shot(ctx, pick(r, this.pools.plop), t, this.lvl.tapLevel * 1.2 * logBetween(r, 0.3, 1), between(r, 0.85, 1.15), this.pans[this.spot()]);
  }

  /** A gutter that drips for a while at its own steady-ish pace and pitch, then stops for a while. */
  private drip(ctx: Ctx, t: number): void {
    const p = this.pools;
    if (!p) return;
    const r = this.rng;
    const g = this.gutter;
    if (t >= g.until) {
      g.on = !g.on;
      g.until = t + (g.on ? between(r, 15, 50) : between(r, 10, 35));
      if (g.on) {
        g.buf = pick(r, p.drip);
        g.period = between(r, 0.7, 1.7);
        g.at = pick(r, [0, 1, 3, 4]);
        g.level = between(r, 0.07, 0.11);
      }
      return;
    }
    if (g.on && g.buf) shot(ctx, g.buf, t, g.level * between(r, 0.75, 1), between(r, 0.97, 1.03), this.pans[g.at]);
  }
}

/** The two noise loops under the rain (pink for the wash, brown for the roof), made once per context. Storm reuses them. */
export function rainBeds(ctx: Ctx, rng: Rng): AudioBuffer[] {
  const fs = ctx.sampleRate;
  return cached(ctx, 'rain:beds', () => [
    toBuffer(ctx, stereoNoise(Math.floor(fs * 12.1), rng, pinkLoop, 0.25)),
    toBuffer(ctx, stereoNoise(Math.floor(fs * 9.7), rng, brownLoop, 0.5)),
  ]);
}

/** Steady rain on the window and the roof, no music. */
export class Rain extends AmbientSynth {
  private readonly bed: RainBed;
  constructor(rng: Rng = Math.random) {
    super(rng);
    this.bed = new RainBed(rng, LIGHT);
  }
  protected buffers(ctx: Ctx): ReadonlyArray<() => void> {
    return this.bed.buffers(ctx);
  }
  protected build(ctx: Ctx, out: AudioNode): AudioScheduledSourceNode[] {
    return this.bed.build(ctx, out);
  }
  protected schedule(_ctx: Ctx, from: number, to: number): void {
    this.bed.schedule(from, to);
  }
  protected teardown(): void {
    this.bed.teardown();
  }
}

/**
 * A seamless stereo loop of many tiny impacts (`perSec` of them): damped sines at random pitch, level and position,
 * wrapped around the loop end, then band-limited with loop-safe filters. Normalised to an RMS of 0.25.
 */
export function patterLoop(fs: number, seconds: number, perSec: number, rng: Rng, [fLo, fHi]: number[], [tauLo, tauHi]: number[]): Float32Array[] {
  const len = Math.floor(fs * seconds);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const n = Math.floor(perSec * seconds);
  for (let k = 0; k < n; k++) {
    const start = Math.floor(rng() * len);
    const f = logBetween(rng, fLo, fHi);
    const tau = (between(rng, tauLo, tauHi) / 1000) * fs;
    const amp = logBetween(rng, 0.05, 1);
    const pan = rng() * 2 - 1;
    const gl = amp * Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = amp * Math.sin(((pan + 1) * Math.PI) / 4);
    const ph = rng() * Math.PI * 2;
    const w = (2 * Math.PI * f) / fs;
    const att = Math.max(2, Math.round(0.0001 * fs));
    const m = Math.ceil(tau * 6);
    for (let i = 0; i < m; i++) {
      const v = Math.sin(ph + w * i) * Math.exp(-i / tau) * Math.min(1, i / att) * 0.8 + (rng() * 2 - 1) * Math.exp(-i / (tau * 0.3)) * 0.2;
      const j = (start + i) % len;
      L[j] += v * gl;
      R[j] += v * gr;
    }
  }
  for (const d of [L, R]) {
    Biquad.highpass(300, 0.6, fs).runLoop(d);
    Biquad.lowpass(6500, 0.6, fs).runLoop(d);
  }
  let s = 0;
  for (let i = 0; i < len; i++) s += L[i] * L[i] + R[i] * R[i];
  const k = 0.25 / Math.sqrt(s / (2 * len) || 1);
  for (let i = 0; i < len; i++) {
    L[i] *= k;
    R[i] *= k;
  }
  return [L, R];
}

/**
 * A drop falling into the gutter outside: a tiny click, then a bubble ringing up in pitch (the classic "plink"), with
 * a faint echo from the downpipe, dulled by the window.
 */
function gutterDrip(fs: number, rng: Rng): Float32Array {
  const len = Math.floor(0.3 * fs);
  const d = new Float32Array(len);
  const f0 = logBetween(rng, 700, 1300);
  const rise = between(rng, 0.6, 1.4);
  const tau = between(rng, 0.018, 0.04);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / fs;
    ph += (2 * Math.PI * f0 * (1 + rise * (1 - Math.exp(-t / 0.012)))) / fs;
    d[i] = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0008);
  }
  for (let i = 0; i < Math.floor(0.0006 * fs); i++) d[i] += (rng() * 2 - 1) * 0.3;
  const echo = Math.floor(between(rng, 0.028, 0.045) * fs);
  for (let i = len - 1; i >= echo; i--) d[i] += d[i - echo] * 0.22;
  return finish(Biquad.lowpass(4000, 0.7, fs).run(d), 1, 2000);
}
