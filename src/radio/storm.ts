import type { Rng } from '../core/rng';
import { AmbientSynth, between, type Ctx, filter, gainNode, logBetween, loop, smoothRandomLoop, Stream } from './ambient-kit';
import { HEAVY, RainBed, rainBeds } from './rain';

/**
 * A winter storm outside a warm room: heavy rain (the Rain bed, poured harder), gusting wind through slowly wandering
 * band-passes, and distant thunder every 20–60 s: a long, rolling rumble of low-passed noise with a slow attack,
 * several swells and a long tail, sometimes with a closer crack first. All synthesized, no audio files.
 */
export class Storm extends AmbientSynth {
  private readonly bed: RainBed;
  private streams: Stream[] = [];
  private wind: { body: GainNode; bodyBp: BiquadFilterNode; whistle: GainNode; whistleBp: BiquadFilterNode; low: GainNode } | null = null;
  private thunderBus: GainNode | null = null;
  private rumbleBuf: AudioBuffer | null = null;
  private crackBuf: AudioBuffer | null = null;
  /** The wind's strength, 0..1, as of the last turn. */
  private gust = 0.4;
  /** A gust (true) or a lull, and how long it holds. */
  private inGust = false;
  private hold = 3;

  constructor(rng: Rng = Math.random) {
    super(rng);
    this.bed = new RainBed(rng, HEAVY);
  }

  /** The heavy rain's buffers; the wind and thunder play the rain's noise beds, so they need none of their own. */
  protected buffers(ctx: Ctx): ReadonlyArray<() => void> {
    return this.bed.buffers(ctx);
  }

  protected build(ctx: Ctx, out: AudioNode): AudioScheduledSourceNode[] {
    const r = this.rng;
    const beds = this.bed.build(ctx, out);
    // The rain's noise loops, reused (each plays from its own random point, through its own filters): no new buffers.
    const [pink, brown] = rainBeds(ctx, r);
    this.rumbleBuf = brown;
    this.crackBuf = pink;

    // Wind: a broad body and a faint narrower "whistle" round the house, both through band-passes that wander with
    // each gust, and a low push against the walls. Heard from inside, so nothing above ~2 kHz.
    const windBus = gainNode(ctx, 1);
    windBus.connect(filter(ctx, 'lowpass', 2000, 0.6)).connect(out);
    const w = loop(ctx, pink, 0.93);
    const bodyBp = filter(ctx, 'bandpass', 450, 0.9);
    const body = gainNode(ctx, 0.1);
    w.connect(bodyBp).connect(body).connect(windBus);
    const whistleBp = filter(ctx, 'bandpass', 900, 3);
    const whistle = gainNode(ctx, 0.02);
    w.connect(whistleBp).connect(whistle).connect(windBus);
    const lw = loop(ctx, brown, 0.9);
    const low = gainNode(ctx, 0.15);
    lw.connect(filter(ctx, 'lowpass', 220, 0.7)).connect(low).connect(windBus);
    this.wind = { body, bodyBp, whistle, whistleBp, low };

    this.thunderBus = gainNode(ctx, 1);
    this.thunderBus.connect(filter(ctx, 'highpass', 30, 0.7)).connect(out);

    const t0 = ctx.currentTime;
    this.gust = 0.4;
    this.inGust = false;
    this.hold = 3;
    this.streams = [
      new Stream(() => this.hold, (t) => (this.hold = this.gusting(t)), t0),
      new Stream(() => thunderGap(r), (t) => this.thunder(ctx, t, r() < 0.3), t0 + between(r, 6, 18)),
    ];
    return [...beds, w, lw];
  }

  protected schedule(_ctx: Ctx, from: number, to: number): void {
    this.bed.schedule(from, to);
    for (const s of this.streams) s.run(from, to);
  }

  protected teardown(): void {
    this.bed.teardown();
    this.streams = [];
    this.wind = null;
    this.thunderBus = null;
    this.rumbleBuf = this.crackBuf = null;
  }

  /**
   * Gusts and lulls take turns: a gust swells in over about a second and holds a few seconds, a lull sighs away more
   * slowly. Its strength steers the level (squared, for a wide range) and every filter centre. Returns how long this
   * turn lasts.
   */
  private gusting(t: number): number {
    const w = this.wind;
    const r = this.rng;
    this.inGust = !this.inGust;
    this.gust = this.inGust ? (r() < 0.25 ? between(r, 0.8, 1) : between(r, 0.4, 0.8)) : between(r, 0.05, 0.3);
    const g = this.gust;
    const tc = this.inGust ? between(r, 0.5, 1.3) : between(r, 1.4, 3);
    if (w) {
      w.body.gain.setTargetAtTime(0.04 + 0.42 * g * g, t, tc);
      w.bodyBp.frequency.setTargetAtTime(280 + 480 * g + between(r, -70, 70), t, tc * 1.5);
      w.bodyBp.Q.setTargetAtTime(0.7 + 0.7 * g, t, tc);
      w.whistle.gain.setTargetAtTime(0.004 + 0.1 * g * g * g, t, tc);
      w.whistleBp.frequency.setTargetAtTime(620 + 650 * g + between(r, -80, 80), t, tc * 1.5);
      w.low.gain.setTargetAtTime(0.06 + 0.24 * g, t, tc);
    }
    return this.inGust ? between(r, 1.5, 4.5) : between(r, 2, 6);
  }

  /** A rumble rolling across the sky, from a little left or right. A close one cracks first and rumbles brighter. */
  private thunder(ctx: Ctx, t: number, close: boolean): void {
    const bus = this.thunderBus;
    if (!bus || !this.rumbleBuf || !this.crackBuf) return;
    const r = this.rng;
    const pan = ctx.createStereoPanner();
    const p0 = between(r, -0.6, 0.6);
    pan.pan.setValueAtTime(p0, t);
    pan.connect(bus);

    let start = t;
    if (close) {
      const crack = ctx.createBufferSource();
      crack.buffer = this.crackBuf;
      const cg = ctx.createGain();
      cg.gain.value = 0;
      const dur = 1.4;
      cg.gain.setValueCurveAtTime(crackCurve(r, dur), t, dur);
      crack.connect(filter(ctx, 'highpass', 250, 0.6)).connect(filter(ctx, 'lowpass', between(r, 2400, 3400), 0.5)).connect(cg).connect(pan);
      crack.start(t, r() * 10);
      crack.stop(t + dur + 0.05);
      start = t + between(r, 0.05, 0.25);
    }

    const dur = close ? between(r, 9, 14) : between(r, 8, 16);
    const src = ctx.createBufferSource();
    src.buffer = this.rumbleBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.6;
    // Bright enough at the start (360 Hz and up) to carry on laptop speakers, gliding down as it rolls away.
    const f0 = close ? between(r, 600, 900) : between(r, 360, 560);
    const f1 = between(r, 110, 160);
    lp.frequency.value = f0;
    lp.frequency.setValueCurveAtTime(cutoffCurve(f0, f1, dur), start, dur);
    const g = ctx.createGain();
    g.gain.value = 0;
    const level = close ? between(r, 0.6, 0.75) : logBetween(r, 0.6, 1);
    g.gain.setValueCurveAtTime(rumbleCurve(r, dur, close, level), start, dur);
    pan.pan.linearRampToValueAtTime(Math.max(-0.8, Math.min(0.8, p0 + between(r, -0.5, 0.5))), start + dur);
    src.connect(lp).connect(g).connect(pan);
    src.start(start, r() * 9);
    src.stop(start + dur + 0.05);
    this.keep(src);
  }
}

/** Seconds between one rumble of thunder and the next: every 20 to 60 s. */
export const thunderGap = (rng: Rng): number => between(rng, 20, 60);

const CURVE_HZ = 60;
/** The crack is band-limited pink noise (RMS well under 0.1), so its envelope peaks above 1. */
const CRACK_GAIN = 1.3;

/**
 * The rumble's envelope: a slow attack, three to six swells of random size (the first not always the biggest), a long
 * tail, and a fast irregular roll on top. Starts and ends at zero.
 */
function rumbleCurve(rng: Rng, dur: number, close: boolean, level: number): Float32Array {
  const n = Math.max(2, Math.round(dur * CURVE_HZ));
  const env = new Float32Array(n);
  const swells: [number, number, number, number][] = [];
  let at = close ? between(rng, 0.05, 0.3) : between(rng, 0.4, 1.4);
  const k = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < k && at < dur * 0.6; i++) {
    const amp = i === 0 && close ? 1 : between(rng, 0.35, 1);
    swells.push([at, amp, between(rng, 0.25, 0.8) * (close && i === 0 ? 0.3 : 1), between(rng, 0.8, 2.6)]);
    at += between(rng, 0.6, 2.4);
  }
  const roll = smoothRandomLoop(n, CURVE_HZ, 1 / between(rng, 4, 8), rng);
  const tail = dur * between(rng, 0.28, 0.4);
  for (let i = 0; i < n; i++) {
    const t = i / CURVE_HZ;
    let e = 0;
    for (const [t0, a, rise, fall] of swells) {
      if (t < t0) continue;
      const x = t - t0;
      e += a * (1 - Math.exp(-x / rise)) * Math.exp(-x / fall);
    }
    // A long, soft tail that outlasts the swells.
    e += 0.25 * Math.min(1, t / 1.5) * Math.exp(-t / tail);
    env[i] = e * (1 + 0.35 * roll[i]);
  }
  let m = 0;
  for (const v of env) m = Math.max(m, v);
  const fadeIn = Math.max(1, Math.round(0.05 * CURVE_HZ));
  const fadeOut = Math.round(1.5 * CURVE_HZ);
  for (let i = 0; i < n; i++) {
    env[i] = (Math.max(0, env[i]) / m) * level * Math.min(1, i / fadeIn) * Math.min(1, (n - 1 - i) / fadeOut);
  }
  return env;
}

/** The low-pass glides down as the rumble rolls away (exponentially, so the ear hears it even). */
function cutoffCurve(f0: number, f1: number, dur: number): Float32Array {
  const n = Math.max(2, Math.round(dur * 20));
  return Float32Array.from({ length: n }, (_, i) => f0 * (f1 / f0) ** (i / (n - 1)));
}

/** A close crack: a ragged burst of sharp spikes over ~0.2 s, then a quick decay. 1 kHz resolution. */
function crackCurve(rng: Rng, dur: number): Float32Array {
  const hz = 1000;
  const n = Math.round(dur * hz);
  const env = new Float32Array(n);
  const ragged = between(rng, 0.12, 0.25);
  let t = 0;
  while (t < ragged) {
    const a = between(rng, 0.4, 1);
    const i0 = Math.floor(t * hz);
    const tau = between(rng, 6, 20);
    for (let i = i0; i < n; i++) env[i] += a * Math.exp(-(i - i0) / tau) * Math.min(1, (i - i0 + 1) / 2);
    t += between(rng, 0.008, 0.03);
  }
  for (let i = 0; i < n; i++) env[i] += 0.5 * Math.exp(-i / (0.35 * hz)) * Math.min(1, i / 5);
  let m = 0;
  for (const v of env) m = Math.max(m, v);
  const fade = 200;
  for (let i = 0; i < n; i++) env[i] = (env[i] / m) * CRACK_GAIN * Math.min(1, (n - 1 - i) / fade);
  env[0] = 0;
  return env;
}
