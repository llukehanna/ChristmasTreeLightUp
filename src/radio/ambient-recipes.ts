import { mulberry32, type Rng } from '../core/rng';
import { AMBIENT_RATE, between, Biquad, brownLoop, finish, logBetween, type Pcm, pinkLoop, smoothRandomLoop, stereoNoise } from './ambient-dsp';

/**
 * The noise the ambiences are made of, as pure functions of an rng (no DOM, no audio types), so a worker can render
 * them (ambient-worker.ts) and the main thread can too, where there is no worker. Every set is rendered at AMBIENT_RATE.
 */

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

/** `n` one-shots, each made by `make`, as a set of mono buffers. */
const pool = (n: number, make: (rng: Rng) => Float32Array) => (rng: Rng): Pcm => Array.from({ length: n }, () => [make(rng)]);

const fs = AMBIENT_RATE;

/**
 * Every set of buffers, by key: the fireplace's (`fire:`) and the rain's (`rain:`), which Storm shares (its heavier
 * patter is its own). The pools are shared by both rain levels.
 */
export const RECIPES: Record<string, (rng: Rng) => Pcm> = {
  /** The roar, the flames and the flicker that moves them: the long loops. */
  'fire:beds': (r) => [stereoNoise(Math.floor(fs * 13), r, brownLoop, 0.8), stereoNoise(Math.floor(fs * 11), r, pinkLoop, 0.6), [smoothRandomLoop(Math.floor(fs * 9.3), fs, 0.06, r)]],
  'fire:tick': pool(16, (r) => strike(fs, r, { burstMs: between(r, 0.2, 0.8), modes: [[logBetween(r, 1800, 4200), between(r, 1.2, 3), 1]], click: 0.6, lp: 6500, maxMs: 15 })),
  'fire:snap': pool(32, (r) => {
    const f = logBetween(r, 700, 3000);
    const q = logBetween(r, 4, 18);
    return strike(fs, r, { burstMs: between(r, 1, 5), modes: [[f, q, 1], [f * between(r, 1.5, 2.7), q * 0.7, between(r, 0.2, 0.5)]], click: 0.45, lp: 6000, maxMs: 90 });
  }),
  'fire:pop': pool(8, (r) => {
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
  'fire:hiss': pool(4, (r) => sapHiss(fs, r)),
  'fire:thud': pool(3, (r) => logThud(fs, r)),
  /** The two noise loops under the rain (pink for the wash, brown for the roof). Storm reuses them. */
  'rain:beds': (r) => [stereoNoise(Math.floor(fs * 12.1), r, pinkLoop, 0.25), stereoNoise(Math.floor(fs * 9.7), r, brownLoop, 0.5)],
  /** The two loops of tiny impacts (fine patter and fatter drops), denser for the heavy rain. */
  'rain:patter': (r) => [patterLoop(fs, 7.3, 420, r, [1500, 5000], [0.4, 1.4]), patterLoop(fs, 11.9, 55, r, [900, 3500], [1, 4])],
  'rain:patter-heavy': (r) => [patterLoop(fs, 7.3, 650, r, [1500, 5000], [0.4, 1.4]), patterLoop(fs, 11.9, 90, r, [900, 3500], [1, 4])],
  'rain:tap': pool(24, (r) => {
    const f = logBetween(r, 1500, 4500);
    const q = logBetween(r, 5, 16);
    return strike(fs, r, { burstMs: between(r, 0.2, 0.8), modes: [[f, q, 1], [f * between(r, 1.3, 2.1), q * 0.8, between(r, 0.2, 0.5)]], click: 0.5, lp: 6500, maxMs: 50 });
  }),
  'rain:plop': pool(8, (r) => {
    const f = logBetween(r, 500, 1300);
    return strike(fs, r, { burstMs: between(r, 0.8, 2.5), modes: [[f, between(r, 3, 6), 1], [f * between(r, 2, 2.6), 6, 0.4]], click: 0.3, lp: 4000, maxMs: 80 });
  }),
  'rain:drip': pool(6, (r) => gutterDrip(fs, r)),
};

/* ---------- the worker's protocol ---------- */

/** Render the set `key`, from an rng seeded with `seed`: the same seed always gives the same noise. */
export interface RenderRequest {
  key: string;
  seed: number;
}
export interface RenderReply {
  key: string;
  pcm: Pcm;
}

/** The worker's whole job: the reply for a request, and the buffers to transfer with it (no copy). */
export function answer(req: RenderRequest): { reply: RenderReply; transfer: ArrayBuffer[] } {
  const make = RECIPES[req.key];
  if (!make) throw new Error(`no ambient recipe "${req.key}"`);
  const pcm = make(mulberry32(req.seed));
  return { reply: { key: req.key, pcm }, transfer: pcm.flatMap((channels) => channels.map((c) => c.buffer as ArrayBuffer)) };
}
