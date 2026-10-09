import { BeatTracker } from './beat';

/** Average energy (0..1) of the bins between two frequencies. */
export function bandEnergies(bins: Uint8Array, binHz: number): { low: number; mid: number; high: number } {
  const avg = (from: number, to: number) => {
    const a = Math.max(0, Math.floor(from / binHz));
    const b = Math.min(bins.length, Math.ceil(to / binHz));
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += bins[i];
    return s / ((b - a) * 255);
  };
  return { low: avg(20, 150), mid: avg(150, 2000), high: avg(2000, 8000) };
}

/**
 * The low band (20–150 Hz, as bandEnergies) as linear amplitude, 1 at `maxDb`: secret mode's beat input (spec 2026-10-08
 * secret mode §5.1). The analyser's bytes are dB-scaled, so over a held bass a kick lifts their average by too little to
 * clear BEAT.ratio; undone into amplitude, the same kick stands well clear. A few bins per frame, no allocation.
 */
export function lowAmplitude(bins: Uint8Array, binHz: number, minDb: number, maxDb: number): number {
  const a = Math.max(0, Math.floor(20 / binHz));
  const b = Math.min(bins.length, Math.ceil(150 / binHz));
  if (b <= a) return 0;
  const k = (maxDb - minDb) / 255;
  let s = 0;
  for (let i = a; i < b; i++) s += 10 ** ((bins[i] * k + minDb - maxDb) / 20);
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
  /** Secret mode's beat (src/radio/beat.ts), fed from the same samples (as linear amplitude), before and after the win. */
  readonly beat = new BeatTracker();
  private readonly detector = new BeatDetector();
  private bins = new Uint8Array(0);

  constructor(private readonly getAnalyser: () => AnalyserNode | null) {}

  sample(now: number): void {
    const a = this.getAnalyser();
    if (!a) return;
    if (this.bins.length !== a.frequencyBinCount) this.bins = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(this.bins);
    const binHz = a.context.sampleRate / a.fftSize;
    const e = bandEnergies(this.bins, binHz);
    this.low = this.low * 0.8 + e.low * 0.2;
    if (this.detector.update(e.low, now)) this.beatAt = now;
    this.beat.update(lowAmplitude(this.bins, binHz, a.minDecibels, a.maxDecibels), now);
  }

  /** Extra brightness for a bulb in `row` (0 = top, 8 = bottom): bottom rows pulse first. */
  extraBulb(row: number, now: number): number {
    const t = now - this.beatAt - (8 - row) * 25;
    return t < 0 ? 0 : 0.9 * Math.exp(-t / 180);
  }
}
