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
  smoothRandomLoop,
  stereoNoise,
  Stream,
  toBuffer,
} from './ambient-kit';

/**
 * A wood fire in a quiet room (spec §5.2), all synthesized, no audio files:
 * - a warm low roar (brown noise under a breathing low-pass) and the soft flutter of flames (pink noise, 220–1400 Hz,
 *   amplitude-modulated by a smooth random signal), both rising and falling together on slow random targets;
 * - crackles from pre-rendered pools, each a few-ms noise burst rung through baked resonances with their own
 *   frequency and Q: tiny ticks, sharper snaps, rare deeper pops and the hiss of sap;
 * - Poisson timing under a slowly wandering intensity, with snaps that set off clusters, so it never ticks like a clock;
 * - now and then a log settles: a soft thud, a flare in the roar and a shower of small crackles.
 * Crackles go through five fixed stereo positions and one gentle low-pass: no fizz above ~6 kHz.
 */
export class Fireplace extends AmbientSynth {
  private pools: { tick: AudioBuffer[]; snap: AudioBuffer[]; pop: AudioBuffer[]; hiss: AudioBuffer[]; thud: AudioBuffer[] } | null = null;
  private pans: AudioNode[] = [];
  private roarGain: GainNode | null = null;
  private roarLp: BiquadFilterNode | null = null;
  private flameGain: GainNode | null = null;
  private streams: Stream[] = [];
  /** How lively the crackling is (≈0.25–1.5), wandering toward `target`. */
  private intensity = 0.7;
  private target = 0.7;
  /** The roar's breath, 0..1: level and brightness rise together. */
  private breath = 0.5;

  constructor(rng: Rng = Math.random) {
    super(rng);
  }

  protected build(ctx: Ctx, out: AudioNode): AudioScheduledSourceNode[] {
    const r = this.rng;
    const fs = ctx.sampleRate;
    const [roarBuf, flameBuf, flickerBuf] = cached(ctx, 'fire:beds', () => [
      toBuffer(ctx, stereoNoise(Math.floor(fs * 13), r, brownLoop, 0.8)),
      toBuffer(ctx, stereoNoise(Math.floor(fs * 11), r, pinkLoop, 0.6)),
      toBuffer(ctx, [smoothRandomLoop(Math.floor(fs * 9.3), fs, 0.06, r)]),
    ]);

    const roar = loop(ctx, roarBuf);
    const roarLp = filter(ctx, 'lowpass', 380, 0.5);
    const roarGain = gainNode(ctx, ROAR.lo);
    roar.connect(filter(ctx, 'highpass', 70, 0.6)).connect(roarLp).connect(roarGain).connect(out);

    const flame = loop(ctx, flameBuf);
    const flameGain = gainNode(ctx, FLAME.lo);
    flame.connect(filter(ctx, 'highpass', 220, 0.6)).connect(filter(ctx, 'lowpass', 1400, 0.6)).connect(flameGain).connect(out);

    // One smooth random signal flickers both layers (a flame flaring is louder and brighter at once).
    const flicker = loop(ctx, flickerBuf);
    flicker.connect(gainNode(ctx, FLAME.flicker)).connect(flameGain.gain);
    flicker.connect(gainNode(ctx, ROAR.flicker)).connect(roarGain.gain);

    const crackleBus = gainNode(ctx, 1);
    crackleBus.connect(filter(ctx, 'lowpass', 6500, 0.6)).connect(out);
    this.pans = panBuses(ctx, crackleBus, [-0.6, -0.3, 0, 0.3, 0.6]);
    this.pools = this.poolsFrom(ctx);
    this.roarGain = roarGain;
    this.roarLp = roarLp;
    this.flameGain = flameGain;

    const t0 = ctx.currentTime;
    this.intensity = this.target = 0.7;
    this.breath = 0.5;
    this.streams = [
      new Stream(() => 0.35, () => this.wander(), t0),
      new Stream(() => between(r, 1.2, 3.2), (t) => this.breathe(t), t0),
      new Stream(() => poisson(r, 7 * this.intensity), (t) => this.tick(ctx, t)),
      new Stream(() => poisson(r, 0.5 + 3 * this.intensity * this.intensity), (t) => this.snap(ctx, t)),
      new Stream(() => poisson(r, (0.6 + this.intensity) / 16), (t) => this.pop(ctx, t), t0 + between(r, 3, 12)),
      new Stream(() => between(r, 18, 55), (t) => this.hiss(ctx, t), t0 + between(r, 8, 30)),
      new Stream(() => settleGap(r), (t) => this.settle(ctx, t), t0 + between(r, 25, 70)),
    ];
    return [roar, flame, flicker];
  }

  protected schedule(_ctx: Ctx, from: number, to: number): void {
    for (const s of this.streams) s.run(from, to);
  }

  protected teardown(): void {
    this.pools = null;
    this.pans = [];
    this.streams = [];
    this.roarGain = this.flameGain = null;
    this.roarLp = null;
  }

  private poolsFrom(ctx: Ctx): NonNullable<Fireplace['pools']> {
    const fs = ctx.sampleRate;
    const r = this.rng;
    const one = (key: string, n: number, make: () => Float32Array) => cached(ctx, key, () => Array.from({ length: n }, () => toBuffer(ctx, [make()])));
    return {
      tick: one('fire:tick', 16, () => strike(fs, r, { burstMs: between(r, 0.2, 0.8), modes: [[logBetween(r, 1800, 4200), between(r, 1.2, 3), 1]], click: 0.6, lp: 6500, maxMs: 15 })),
      snap: one('fire:snap', 32, () => {
        const f = logBetween(r, 700, 3000);
        const q = logBetween(r, 4, 18);
        return strike(fs, r, { burstMs: between(r, 1, 5), modes: [[f, q, 1], [f * between(r, 1.5, 2.7), q * 0.7, between(r, 0.2, 0.5)]], click: 0.45, lp: 6000, maxMs: 90 });
      }),
      pop: one('fire:pop', 8, () => {
        const f = logBetween(r, 220, 650);
        return strike(fs, r, {
          burstMs: between(r, 2, 6),
          modes: [[f, between(r, 4, 10), 1], [f * between(r, 2.2, 3.4), 6, 0.35]],
          click: 0.25,
          thump: [between(r, 80, 140), between(r, 25, 50), 0.6],
          lp: 4500,
          maxMs: 160,
        });
      }),
      hiss: one('fire:hiss', 4, () => sapHiss(fs, r)),
      thud: one('fire:thud', 3, () => logThud(fs, r)),
    };
  }

  /** The crackling's liveliness drifts toward a target that is re-picked every few seconds (τ ≈ 3 s). */
  private wander(): void {
    const r = this.rng;
    if (r() < 0.07) this.target = r() < 0.15 ? between(r, 1.2, 1.5) : logBetween(r, 0.4, 1.1);
    this.intensity += (this.target - this.intensity) * 0.12;
  }

  private breathe(t: number): void {
    const r = this.rng;
    // Some memory of the last breath, pulled toward a fresh draw: always moving, never stuck at an end.
    this.breath = 0.3 * this.breath + 0.7 * r();
    this.setBreath(t, this.breath, between(r, 0.6, 1.4));
  }

  private setBreath(t: number, b: number, tc: number): void {
    this.roarGain?.gain.setTargetAtTime(ROAR.lo + (ROAR.hi - ROAR.lo) * b, t, tc);
    this.roarLp?.frequency.setTargetAtTime(260 + 460 * b, t, tc);
    this.flameGain?.gain.setTargetAtTime(FLAME.lo + (FLAME.hi - FLAME.lo) * b, t, tc);
  }

  /** A pan bus near the middle more often than at the edges. */
  private spot(): number {
    const r = this.rng;
    return Math.min(4, Math.max(0, Math.round(2 + (r() + r() - 1) * 2.4)));
  }

  private play(ctx: Ctx, pool: AudioBuffer[], t: number, level: number, at: number, rate = between(this.rng, 0.88, 1.15)): void {
    shot(ctx, pick(this.rng, pool), t, level, rate, this.pans[at]);
  }

  private tick(ctx: Ctx, t: number): void {
    if (!this.pools) return;
    this.play(ctx, this.pools.tick, t, LEVEL.tick * logBetween(this.rng, 0.35, 1), this.spot());
  }

  private snap(ctx: Ctx, t: number): void {
    const p = this.pools;
    if (!p) return;
    const r = this.rng;
    const at = this.spot();
    this.play(ctx, p.snap, t, LEVEL.snap * logBetween(r, 0.3, 1), at);
    if (r() > 0.15 + 0.15 * this.intensity) return;
    // A run: the same knot of wood keeps going, quieter and quieter, a few tens of ms apart.
    const n = Math.min(14, 2 + Math.floor(-Math.log(1 - r()) / 0.3));
    let when = t;
    let lvl = LEVEL.snap * logBetween(r, 0.3, 0.9);
    for (let i = 0; i < n; i++) {
      when += 0.006 + poisson(r, 1 / 0.035);
      lvl *= between(r, 0.6, 1.02);
      const near = Math.min(4, Math.max(0, at + (r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0)));
      if (r() < 0.6) this.play(ctx, p.snap, when, lvl, near);
      else this.play(ctx, p.tick, when, lvl * 0.7, near);
    }
  }

  private pop(ctx: Ctx, t: number): void {
    if (!this.pools) return;
    this.play(ctx, this.pools.pop, t, LEVEL.pop * between(this.rng, 0.6, 1), this.spot(), between(this.rng, 0.85, 1.12));
  }

  private hiss(ctx: Ctx, t: number): void {
    if (!this.pools) return;
    this.play(ctx, this.pools.hiss, t, LEVEL.hiss * between(this.rng, 0.6, 1), this.spot(), between(this.rng, 0.9, 1.1));
  }

  /** A log settles: a soft low thud, the roar flares, and a shower of small crackles patters down. */
  private settle(ctx: Ctx, t: number): void {
    const p = this.pools;
    if (!p) return;
    const r = this.rng;
    const at = 1 + Math.floor(r() * 3);
    this.play(ctx, p.thud, t, LEVEL.thud * between(r, 0.7, 1), at, between(r, 0.9, 1.1));
    // The roar flares as the embers are stirred, then settles back over a few seconds.
    this.setBreath(t + 0.04, 1.25, 0.25);
    this.setBreath(t + 1.2, 0.55, 1.6);
    this.breath = 0.55;
    this.target = Math.max(this.target, 1.2);
    let when = t + 0.05;
    const n = 8 + Math.floor(r() * 14);
    for (let i = 0; i < n; i++) {
      when += poisson(r, 1 / 0.075);
      const near = Math.min(4, Math.max(0, at + Math.round(between(r, -1.4, 1.4))));
      const lvl = logBetween(r, 0.3, 1) * (1 - (0.6 * i) / n);
      if (r() < 0.55) this.play(ctx, p.tick, when, LEVEL.tick * 1.3 * lvl, near);
      else this.play(ctx, p.snap, when, LEVEL.snap * 0.6 * lvl, near);
    }
    if (r() < 0.4) this.play(ctx, p.pop, when + between(r, 0.1, 0.6), LEVEL.pop * 0.6, at);
  }
}

/** Seconds between one log settling and the next: every 60 to 150 s. */
export const settleGap = (rng: Rng): number => between(rng, 60, 150);

/** Bed levels: the breath moves each between lo and hi; `flicker` is the depth of the fast flame flutter. */
const ROAR = { lo: 0.11, hi: 0.27, flicker: 0.035 };
const FLAME = { lo: 0.025, hi: 0.055, flicker: 0.02 };
/** Peak level of each kind of one-shot (every pooled buffer peaks at 1). */
const LEVEL = { tick: 0.25, snap: 0.6, pop: 0.6, hiss: 0.07, thud: 0.6 };

interface StrikeSpec {
  /** Length of the noise burst that excites the resonances. */
  burstMs: number;
  /** [frequency Hz, Q, relative level] of each resonance the burst rings. */
  modes: [number, number, number][];
  /** Level of the raw burst itself (the dry "crack"). */
  click: number;
  /** A low decaying sine under it: [Hz, decay ms, level]. */
  thump?: [number, number, number];
  /** A final low-pass, so nothing fizzes. */
  lp: number;
  maxMs: number;
}

/** One crackle: a short noise burst rung through damped resonances (each mode a band-pass with its own f and Q). */
export function strike(fs: number, rng: Rng, o: StrikeSpec): Float32Array {
  const burst = Math.max(4, Math.round((o.burstMs * fs) / 1000));
  const tau = Math.max(...o.modes.map(([f, q]) => q / (Math.PI * f)));
  const len = Math.min(Math.round((o.maxMs * fs) / 1000), burst + Math.round(7 * tau * fs) + 64);
  const att = Math.max(2, Math.round(0.00015 * fs)); // a 0.15 ms rise: no step, so no ear-piercing click
  const exc = new Float32Array(len);
  for (let i = 0; i < burst; i++) exc[i] = (rng() * 2 - 1) * (i < att ? i / att : Math.exp(-(i - att) / (burst / 3)));
  const out = new Float32Array(len);
  const add = (d: Float32Array, level: number) => {
    let m = 0;
    for (const v of d) m = Math.max(m, Math.abs(v));
    if (m > 0) for (let i = 0; i < len; i++) out[i] += (d[i] / m) * level;
  };
  for (const [f, q, a] of o.modes) add(Biquad.bandpass(f, q, fs).run(exc.slice()), a);
  add(Biquad.lowpass(o.lp, 0.7, fs).run(exc.slice()), o.click);
  if (o.thump) {
    const [f, ms, a] = o.thump;
    const d = new Float32Array(len);
    const k = (ms / 1000) * fs;
    for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * f * i) / fs) * Math.exp(-i / k) * Math.min(1, i / (0.002 * fs));
    add(d, a);
  }
  return finish(Biquad.lowpass(o.lp, 0.7, fs).run(out), 1, Math.min(96, len >> 2));
}

/** Sap boiling out of a log: a soft, sputtering hiss in the 2–4 kHz region, under a second long. */
function sapHiss(fs: number, rng: Rng): Float32Array {
  const dur = between(rng, 0.7, 2.2);
  const len = Math.floor(dur * fs);
  const att = between(rng, 0.08, 0.25) * fs;
  const rel = 0.35 * len;
  const sputter = smoothRandomLoop(len, fs, 0.022, rng);
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const env = Math.min(1, i / att) * Math.min(1, (len - i) / rel) ** 1.5;
    d[i] = (rng() * 2 - 1) * env * (0.55 + 0.45 * sputter[i]);
  }
  Biquad.bandpass(logBetween(rng, 2200, 3800), 1.4, fs).run(d);
  return finish(Biquad.lowpass(5500, 0.7, fs).run(d));
}

/** A log settling onto the grate: low noise thump, a falling ~70 Hz body and a dull woody knock. */
function logThud(fs: number, rng: Rng): Float32Array {
  const len = Math.floor(0.6 * fs);
  const noise = new Float32Array(len);
  for (let i = 0; i < len; i++) noise[i] = (rng() * 2 - 1) * Math.min(1, i / (0.006 * fs)) * Math.exp(-i / (0.09 * fs));
  Biquad.lowpass(160, 0.9, fs).run(noise);
  const f0 = between(rng, 55, 80);
  const knock = new Float32Array(len);
  for (let i = 0; i < Math.floor(0.004 * fs); i++) knock[i] = rng() * 2 - 1;
  Biquad.bandpass(between(rng, 350, 500), 4, fs).run(knock);
  const peak = (d: Float32Array) => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const pn = peak(noise);
  const pk = peak(knock);
  const d = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / fs;
    ph += (2 * Math.PI * f0 * (1 - 0.15 * Math.min(1, t / 0.3))) / fs;
    const body = Math.sin(ph) * Math.exp(-t / 0.12) * Math.min(1, t / 0.004);
    d[i] = (noise[i] / pn) * 0.8 + body * 0.7 + (knock[i] / pk) * 0.3;
  }
  return finish(Biquad.lowpass(900, 0.7, fs).run(d), 1, 2000);
}

