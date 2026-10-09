import { BeatTracker, RESTART_GAP_MS } from './beat';

/** The post-win show's low band (Hz). */
export const LOW_BAND = [20, 150] as const;

/**
 * Secret mode's onset flux (spec 2026-10-08 secret mode §5.1), tuned in real Chromium on synthesized mixes:
 * - `kickBand`: the kick's punch, above an 808's fundamental (a held 808 owns the bins below 120 Hz, which even dip on a
 *   kick); `clickBand`: the beater's attack; `duckBand`: where a limiter's gain change shows when it ducks a loud mix
 *   (followed by at most `duckMaxDb` a frame, so a hard cut or an unramped duck can't pass for a kick);
 *   `voiceBand`: where a voice's formants put a syllable's new power.
 * - Rises are in dB (so loudness, the volume slider and a ducked bus don't matter), each bin floored at `floorDb` and
 *   its rise capped at `capDb`, averaged per band.
 * - The click band scales the kick band's rise (by up to 1 + `clickWeight`): a kick with its attack counts more, and a
 *   hat (a click with no kick under it) counts for nothing.
 * - The result is weighted by how much of the frame's new power (linear, so not by its dB) lands in the kick band rather
 *   than the voice band, `voiceWeight` times over: a kick adds its power low, a rapped syllable in its formants.
 */
export const FLUX = {
  kickBand: [120, 250],
  clickBand: [2000, 6000],
  duckBand: [24, 500],
  voiceBand: [250, 4000],
  floorDb: -100,
  capDb: 40,
  duckMaxDb: 3,
  clickWeight: 0.5,
  voiceWeight: 4,
} as const;
/**
 * The beat's own analyser, tapped off the radio's: 2048 points (a 43 ms window, so 30 fps frames leave no gap a kick
 * could fall into; the radio's 1024 leaves 12 ms unread every frame) and light smoothing (a sharp attack).
 */
export const BEAT_FFT = 2048;
export const BEAT_SMOOTHING = 0.4;
/** A tap that hears nothing this long while the radio's analyser hears music is dead (a browser that never runs it). */
export const TAP_DEAD_MS = 500;

/** The first bin at or above `from` Hz, for bins `binHz` apart. */
export const binLo = (binHz: number, from: number): number => Math.max(0, Math.floor(from / binHz));
/** One past the last bin below `to` Hz, of `len`. */
export const binHi = (len: number, binHz: number, to: number): number => Math.min(len, Math.ceil(to / binHz));

/** Average energy (0..1) of the bins between two frequencies. */
export function bandEnergies(bins: Uint8Array, binHz: number): { low: number; mid: number; high: number } {
  const avg = (from: number, to: number) => {
    const a = binLo(binHz, from);
    const b = binHi(bins.length, binHz, to);
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += bins[i];
    return s / ((b - a) * 255);
  };
  return { low: avg(LOW_BAND[0], LOW_BAND[1]), mid: avg(150, 2000), high: avg(2000, 8000) };
}

/** A bin's level for the flux: floored, and a non-number (silence reads -Infinity) is the floor. */
const level = (db: number): number => (db > FLUX.floorDb ? db : FLUX.floorDb);

/** The mean positive rise (dB, each capped) of bins [a, b) from `prev` to `db`, less `shift` (a duck, ≤ 0). */
function meanRise(db: Float32Array, prev: Float32Array, a: number, b: number, shift: number): number {
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) {
    const d = level(db[i]) - prev[i] - shift;
    if (d > 0) s += d < FLUX.capDb ? d : FLUX.capDb;
  }
  return s / (b - a);
}

/** The new power (linear, the positive part of each bin's change) in bins [a, b). */
function newPower(db: Float32Array, prev: Float32Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) {
    const d = 10 ** (level(db[i]) / 10) - 10 ** (prev[i] / 10);
    if (d > 0) s += d;
  }
  return s;
}

/**
 * Secret mode's onset signal (spec 2026-10-08 secret mode §5.1): half-wave-rectified spectral flux of the float
 * spectrum `db` against the last frame's (`prev`, floored levels; NaN in prev[0] = no last frame):
 * `kick · (1 + clickWeight · click / capDb) · share`, where `kick` is the kick band's mean rise measured against a
 * limiter's duck (the median change across `duckBand`, if below 0, at most `duckMaxDb`), `click` the click band's, and
 * `share = low / (low + voiceWeight · voice)` of the frame's new power. Writes this frame into `prev`; `sorted` is
 * scratch for the median, as long as `duckBand`'s bins (it is sorted whole). No allocation.
 */
export function onsetFlux(db: Float32Array, prev: Float32Array, sorted: Float32Array, binHz: number): number {
  const n = Math.min(db.length, prev.length);
  let e = 0;
  if (!Number.isNaN(prev[0])) {
    const da = binLo(binHz, FLUX.duckBand[0]);
    const m = Math.min(binHi(n, binHz, FLUX.duckBand[1]) - da, sorted.length);
    for (let k = 0; k < m; k++) sorted[k] = level(db[da + k]) - prev[da + k];
    for (let k = m; k < sorted.length; k++) sorted[k] = Number.POSITIVE_INFINITY;
    sorted.sort();
    const duck = m > 0 ? Math.max(-FLUX.duckMaxDb, Math.min(0, sorted[m >> 1])) : 0;
    const ka = binLo(binHz, FLUX.kickBand[0]);
    const kb = binHi(n, binHz, FLUX.kickBand[1]);
    const kick = meanRise(db, prev, ka, kb, duck);
    if (kick > 0) {
      const click = meanRise(db, prev, binLo(binHz, FLUX.clickBand[0]), binHi(n, binHz, FLUX.clickBand[1]), 0);
      const low = newPower(db, prev, ka, kb);
      // The voice band starts where the kick band ends: a kick's top bin is the kick's.
      const voice = newPower(db, prev, Math.max(kb, binLo(binHz, FLUX.voiceBand[0])), binHi(n, binHz, FLUX.voiceBand[1]));
      const share = low > 0 ? low / (low + FLUX.voiceWeight * voice) : 0;
      e = kick * (1 + (FLUX.clickWeight * click) / FLUX.capDb) * share;
    }
  }
  for (let i = 0; i < n; i++) prev[i] = level(db[i]);
  return e;
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

/** Some bin of a float spectrum is above the flux's floor. */
function heard(db: Float32Array): boolean {
  for (let i = 0; i < db.length; i++) if (db[i] > FLUX.floorDb) return true;
  return false;
}

/** Some bin of a byte spectrum is above minDecibels. */
function sounding(bins: Uint8Array): boolean {
  for (let i = 0; i < bins.length; i++) if (bins[i] > 0) return true;
  return false;
}

/** Post-win light show (spec §5.4): beats send a pulse up the tree; the low band breathes the glow. */
export class LightShow {
  beatAt = -Infinity;
  low = 0;
  /** Secret mode's beat (src/radio/beat.ts), fed the onset flux of the beat tap's float spectrum, before and after the win. */
  readonly beat = new BeatTracker();
  private readonly detector = new BeatDetector();
  private bins = new Uint8Array(0);
  /** The beat tap: its own analyser hung off the radio's (which it was made for), or the radio's if it can't be had. */
  private tapOf: AnalyserNode | null = null;
  private tap: AnalyserNode | null = null;
  /** Since when the tap has heard nothing while the radio's analyser heard music (NaN: it hears). */
  private tapQuietSince = Number.NaN;
  /** The beat's spectra (this frame, the last), and scratch for the duck's median: reused every frame. */
  private db = new Float32Array(0);
  private prev = new Float32Array(0);
  private sorted = new Float32Array(0);
  private lastAt = Number.NaN;

  constructor(private readonly getAnalyser: () => AnalyserNode | null) {}

  sample(now: number): void {
    const a = this.getAnalyser();
    if (!a) return;
    if (this.bins.length !== a.frequencyBinCount) this.bins = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(this.bins);
    const e = bandEnergies(this.bins, a.context.sampleRate / a.fftSize);
    this.low = this.low * 0.8 + e.low * 0.2;
    if (this.detector.update(e.low, now)) this.beatAt = now;
    this.sampleBeat(this.beatTap(a), a, now);
  }

  /** Secret mode's beat: the onset flux of the tap's float spectrum (`t`; `a` is the radio's analyser), into the tracker. */
  private sampleBeat(t: AnalyserNode, a: AnalyserNode, now: number): void {
    const n = t.frequencyBinCount;
    const binHz = t.context.sampleRate / t.fftSize;
    if (this.db.length !== n) {
      this.db = new Float32Array(n);
      this.prev = new Float32Array(n);
      this.sorted = new Float32Array(Math.max(0, binHi(n, binHz, FLUX.duckBand[1]) - binLo(binHz, FLUX.duckBand[0])));
      this.prev[0] = Number.NaN;
    }
    // After a gap (a hidden tab, the music paused) the last spectrum is stale: start the flux afresh, as the tracker does.
    if (!(now - this.lastAt <= RESTART_GAP_MS)) this.prev[0] = Number.NaN;
    this.lastAt = now;
    t.getFloatFrequencyData(this.db);
    if (t !== a) this.watchTap(a, now);
    this.beat.update(onsetFlux(this.db, this.prev, this.sorted, binHz), now);
  }

  /** A tap that stays silent while the radio's analyser hears music is never run (a browser quirk): use the radio's. */
  private watchTap(a: AnalyserNode, now: number): void {
    if (heard(this.db) || !sounding(this.bins)) {
      this.tapQuietSince = Number.NaN;
      return;
    }
    if (Number.isNaN(this.tapQuietSince)) this.tapQuietSince = now;
    else if (now - this.tapQuietSince >= TAP_DEAD_MS) this.dropTap(a);
  }

  /** Unhooks the tap from `a`; the radio's analyser stands in. */
  private dropTap(a: AnalyserNode): void {
    if (this.tap) {
      try {
        a.disconnect(this.tap);
      } catch {
        // Already gone.
      }
    }
    this.tap = null;
    this.tapQuietSince = Number.NaN;
  }

  /** The beat tap for the radio's analyser `a`, made once per analyser; `a` itself when a tap can't be had. */
  private beatTap(a: AnalyserNode): AnalyserNode {
    if (a !== this.tapOf) {
      // A new analyser from the radio: let go of the old tap, so it doesn't hang off the old one for good.
      if (this.tapOf) this.dropTap(this.tapOf);
      this.tapOf = a;
      try {
        const t = a.context.createAnalyser();
        t.fftSize = BEAT_FFT;
        t.smoothingTimeConstant = BEAT_SMOOTHING;
        a.connect(t); // an analyser passes its input through: the tap hears the music bus
        this.tap = t;
      } catch {
        // No tap (an old browser): the radio's own analyser, coarser at 30 fps but still a beat.
      }
    }
    return this.tap ?? a;
  }

  /** Extra brightness for a bulb in `row` (0 = top, 8 = bottom): bottom rows pulse first. */
  extraBulb(row: number, now: number): number {
    const t = now - this.beatAt - (8 - row) * 25;
    return t < 0 ? 0 : 0.9 * Math.exp(-t / 180);
  }
}
