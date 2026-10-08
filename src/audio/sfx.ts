import { audio } from './context';

const PENTATONIC = [0, 2, 4, 7, 9];
const G4 = 392;

/** k-th chime of a wave: G-major pentatonic, rising an octave every five notes. */
export const chimeSemitone = (k: number): number => PENTATONIC[k % 5] + 12 * Math.floor(k / 5);

function noise(ctx: AudioContext, seconds: number, shape: (x: number) => number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * shape(k / len);
  return buf;
}

/** The star's bell tick for taps 1–4 (`k` 0..3): an octave above the wave's chimes, a pentatonic step higher each tap. */
export const starTapSemitone = (k: number): number => chimeSemitone(7 + k);

/** Four sine partials, fast attack, slow decay (`ring` scales the decay: below 1 for a short tick). */
function bell(ctx: AudioContext, out: AudioNode, when: number, semitones: number, velocity: number, ring = 1): void {
  const f = G4 * 2 ** (semitones / 12);
  for (const [mul, gain, d] of [
    [1, 1, 1.5],
    [2, 0.32, 0.7],
    [3.01, 0.16, 0.4],
    [4.18, 0.07, 0.22],
  ] as const) {
    const decay = d * ring;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mul;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.085 * velocity * gain), when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + decay + 0.05);
  }
}

/** A sleigh bell's inharmonic partials: [ratio, gain, decay s]. */
const SLEIGH = [
  [1, 1, 0.2],
  [1.47, 0.62, 0.15],
  [2.13, 0.45, 0.11],
  [2.79, 0.3, 0.08],
] as const;

/** One small sleigh bell: bright, slightly detuned partials and the pellet's rattle. */
function sleighBell(ctx: AudioContext, out: AudioNode, when: number, velocity: number): void {
  const f = 2300 + Math.random() * 1500;
  for (const [mul, gain, decay] of SLEIGH) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mul * (1 + (Math.random() - 0.5) * 0.014);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.032 * velocity * gain), when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    o.connect(g);
    g.connect(out);
    o.start(when);
    o.stop(when + decay + 0.03);
  }
  const n = ctx.createBufferSource();
  n.buffer = noise(ctx, 0.03, (x) => (1 - x) ** 2);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const ng = ctx.createGain();
  ng.gain.value = 0.06 * velocity;
  n.connect(hp);
  hp.connect(ng);
  ng.connect(out);
  n.start(when);
}

/** Synthesized game sounds (spec §5.1). No audio files. */
export class Sfx {
  private volume = 0.8;
  /** Called whenever a game sound plays (Plan 2 ducks the music with it). */
  onSound: (() => void) | null = null;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (audio.sfx) audio.sfx.gain.value = this.volume * 0.75;
  }

  unlock(): void {
    audio.unlock();
    this.setVolume(this.volume);
  }

  private begin(): { ctx: AudioContext; out: GainNode } | null {
    if (this.volume <= 0) return null;
    const ctx = audio.unlock();
    if (!ctx || !audio.sfx) return null;
    audio.sfx.gain.value = this.volume * 0.75;
    this.onSound?.();
    return { ctx, out: audio.sfx };
  }

  /** Rotation detent: pitched sine drop + band-passed click. */
  tick(): void {
    const a = this.begin();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(650, t + 0.028);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.06);
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx, 0.018, (x) => (1 - x) ** 3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3400;
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.value = 0.2;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start(t);
  }

  /** A connection landed: noise swell scaled by size, then one chime per bulb at its pop time (max 14). */
  wave(tilesLit: number, bulbDelaysMs: readonly number[]): void {
    const a = this.begin();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    const dur = 0.16 + Math.min(0.5, tilesLit * 0.012);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx, dur, () => 1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(350, t);
    lp.frequency.exponentialRampToValueAtTime(1800 + Math.min(3000, tilesLit * 60), t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04 + Math.min(0.07, tilesLit * 0.002), t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(out);
    src.start(t);
    bulbDelaysMs.slice(0, 14).forEach((ms, k) => bell(ctx, out, t + Math.max(0, ms) / 1000, chimeSemitone(k), 1 - k * 0.03));
  }

  /** A tap on the star (`k` 0..3 for taps 1–4): a short, high bell tick with a glassy click, rising each tap. */
  starTap(k: number): void {
    const a = this.begin();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime;
    bell(ctx, out, t, starTapSemitone(k), 0.6 + 0.1 * k, 0.3);
    const n = ctx.createBufferSource();
    n.buffer = noise(ctx, 0.008, (x) => (1 - x) ** 2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const ng = ctx.createGain();
    ng.gain.value = 0.07;
    n.connect(hp);
    hp.connect(ng);
    ng.connect(out);
    n.start(t);
  }

  /**
   * The topper's flip: three shakes of sleigh bells, then a sparkle of chimes as it turns edge-on (rising to the head,
   * falling back to the star), ringing out as it lands.
   */
  jingle(on: boolean): void {
    const a = this.begin();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.01;
    for (const [at, hits, v] of [
      [0, 5, 0.85],
      [0.13, 4, 0.7],
      [0.26, 6, 1],
    ] as const) {
      for (let k = 0; k < hits; k++) sleighBell(ctx, out, t + at + Math.random() * 0.05, v * (0.6 + 0.4 * Math.random()));
    }
    (on ? [12, 16, 19, 24] : [24, 19, 16, 12]).forEach((st, k) => bell(ctx, out, t + 0.32 + k * 0.06, st, 0.6, 0.8));
    bell(ctx, out, t + 0.56, on ? 28 : 7, 0.4, 0.9);
  }

  /** Rising arpeggio and a resolving low chord. */
  win(): void {
    const a = this.begin();
    if (!a) return;
    const { ctx, out } = a;
    const t = ctx.currentTime + 0.05;
    [0, 4, 7, 12, 16, 19, 24].forEach((st, k) => bell(ctx, out, t + k * 0.07, st, 0.9));
    bell(ctx, out, t + 0.62, -12, 1);
    bell(ctx, out, t + 0.62, -5, 0.8);
    bell(ctx, out, t + 0.62, 4, 0.6);
  }
}
