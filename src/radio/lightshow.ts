import { BeatTracker } from './beat';

/** The low band (Hz): the post-win show's and secret mode's beats both read these bins. */
export const LOW_BAND = [20, 150] as const;
/**
 * Secret mode's amplitude reference (dB): 1 in lowAmplitude. The analyser's default maxDecibels, so the BEAT constants
 * keep the meaning they were measured with; louder bins read above 1 (nothing clips).
 */
export const LOW_REF_DB = -30;

/** The first and one-past-last bin between two frequencies, for `len` bins `binHz` apart (empty when b <= a). */
export function binRange(len: number, binHz: number, from: number, to: number): [number, number] {
  return [Math.max(0, Math.floor(from / binHz)), Math.min(len, Math.ceil(to / binHz))];
}

/** Average energy (0..1) of the bins between two frequencies. */
export function bandEnergies(bins: Uint8Array, binHz: number): { low: number; mid: number; high: number } {
  const avg = (from: number, to: number) => {
    const [a, b] = binRange(bins.length, binHz, from, to);
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += bins[i];
    return s / ((b - a) * 255);
  };
  return { low: avg(LOW_BAND[0], LOW_BAND[1]), mid: avg(150, 2000), high: avg(2000, 8000) };
}

/**
 * The low band as linear amplitude, from the analyser's float spectrum (dB, unclamped), 1 at LOW_REF_DB: secret mode's
 * beat input (spec 2026-10-08 secret mode §5.1). The byte spectrum won't do: it is dB-scaled, so over a held bass a kick
 * barely lifts it, and it clips at maxDecibels, so a loud master pins it at 255 and hides the kick altogether.
 * A few bins per frame, no allocation.
 */
export function lowAmplitude(db: Float32Array, binHz: number): number {
  const [a, b] = binRange(db.length, binHz, LOW_BAND[0], LOW_BAND[1]);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += 10 ** ((db[i] - LOW_REF_DB) / 20);
  return s / (b - a);
}

/** Onset detection on the low band: a jump above the running average, at most one per cooldown. */
export class BeatDetector {
  private avg = 0;
  private last = -Infinity;
  constructor(private readonly threshold = 1.35, private readonly cooldownMs = 180) {}

  update(energy: number, now: number): boolean {
    const beat = energy > 0.08 && energy > this.avg * this.threshold && now - this.last >= this.cooldownMs;
    this.avg = this.avg === 0 ? energy : this.avg * 0.94 + energy * 0.06;
    if (beat) this.last = now;
    return beat;
  }
}

/** Post-win light show (spec §5.4): beats send a pulse up the tree; the low band breathes the glow. */
export class LightShow {
  beatAt = -Infinity;
  low = 0;
  /** Secret mode's beat (src/radio/beat.ts), fed from the same analyser read (the float spectrum, as linear amplitude), before and after the win. */
  readonly beat = new BeatTracker();
  private readonly detector = new BeatDetector();
  private bins = new Uint8Array(0);
  /** The float spectrum for secret mode's beat, reused every frame. */
  private db = new Float32Array(0);

  constructor(private readonly getAnalyser: () => AnalyserNode | null) {}

  sample(now: number): void {
    const a = this.getAnalyser();
    if (!a) return;
    if (this.bins.length !== a.frequencyBinCount) {
      this.bins = new Uint8Array(a.frequencyBinCount);
      this.db = new Float32Array(a.frequencyBinCount);
    }
    a.getByteFrequencyData(this.bins);
    // The same analysis frame (the browser analyses once per render quantum), unclamped: secret mode's beat.
    a.getFloatFrequencyData(this.db);
    const binHz = a.context.sampleRate / a.fftSize;
    const e = bandEnergies(this.bins, binHz);
    this.low = this.low * 0.8 + e.low * 0.2;
    if (this.detector.update(e.low, now)) this.beatAt = now;
    this.beat.update(lowAmplitude(this.db, binHz), now);
  }

  /** Extra brightness for a bulb in `row` (0 = top, 8 = bottom): bottom rows pulse first. */
  extraBulb(row: number, now: number): number {
    const t = now - this.beatAt - (8 - row) * 25;
    return t < 0 ? 0 : 0.9 * Math.exp(-t / 180);
  }
}
