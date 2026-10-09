import { expect, it } from 'vitest';
import { BeatTracker } from '../../../src/radio/beat';
import { BeatDetector, LightShow, bandEnergies, binRange, lowAmplitude } from '../../../src/radio/lightshow';

it('splits spectrum energy into low / mid / high bands (0..1)', () => {
  const bins = new Uint8Array(512);
  for (let i = 0; i < 3; i++) bins[i] = 255; // ~0–129 Hz at 43 Hz per bin
  const e = bandEnergies(bins, 43);
  expect(e.low).toBeGreaterThan(0.5);
  expect(e.mid).toBe(0);
  expect(e.high).toBe(0);
});

it('detects beats as low-energy jumps, with a cooldown', () => {
  const d = new BeatDetector();
  let beats = 0;
  for (let t = 0; t < 2000; t += 20) {
    const kick = t % 500 < 40 ? 0.8 : 0.15;
    if (d.update(kick, t)) beats++;
  }
  expect(beats).toBeGreaterThanOrEqual(3);
  expect(beats).toBeLessThanOrEqual(4);
});

it('pulses bulbs bottom row first after a beat', () => {
  const show = new LightShow(() => null);
  show.beatAt = 1000;
  expect(show.extraBulb(8, 1000 + 30)).toBeGreaterThan(show.extraBulb(0, 1000 + 30));
  expect(show.extraBulb(8, 5000)).toBeLessThan(0.01);
});

/** An analyser with the default dB range (-100..-30) whose every bin reads `db()`: the float spectrum as is, the bytes clamped. */
function fakeAnalyser(db: () => number): AnalyserNode {
  return {
    frequencyBinCount: 512,
    fftSize: 1024,
    minDecibels: -100,
    maxDecibels: -30,
    context: { sampleRate: 44_100 },
    getByteFrequencyData: (bins: Uint8Array) => bins.fill(byteOf(db())),
    getFloatFrequencyData: (bins: Float32Array) => bins.fill(db()),
  } as unknown as AnalyserNode;
}
/** The byte the analyser reports for `db`: clamped to minDecibels -100 … maxDecibels -30. */
const byteOf = (db: number) => Math.min(255, Math.max(0, Math.round(((db + 100) / 70) * 255)));
/** The earlier inputs, for the regressions: the byte average (a682506), and the bytes as amplitude (970431e). */
const byteAverage = (db: number) => byteOf(db) / 255;
const byteAmplitude = (db: number) => 10 ** ((byteOf(db) * (70 / 255) - 70) / 20);

/** Kicks to `kickDb` for 60 ms every 500 ms over a held `holdDb`, for 4 s at 60 fps: the beats the light show finds, and `old`'s. */
function kicksOver(holdDb: number, kickDb: number, old: (db: number) => number) {
  let now = 0;
  const db = () => (now % 500 < 60 ? kickDb : holdDb);
  const show = new LightShow(() => fakeAnalyser(db));
  const before = new BeatTracker();
  const beats: number[] = [];
  let oldBeats = 0;
  for (; now <= 4000; now += 1000 / 60) {
    const at = show.beat.at;
    show.sample(now);
    if (show.beat.at !== at) beats.push(now);
    if (before.update(old(db()), now)) oldBeats++;
  }
  return { beats, strong: show.beat.strong, oldBeats };
}

it('lowAmplitude: the low band as linear amplitude, 1 at -30 dB, unclamped above it', () => {
  const db = new Float32Array(512).fill(-100);
  db.fill(-30, 0, 4);
  expect(lowAmplitude(db, 43)).toBeCloseTo(1);
  db.fill(-50, 0, 4); // 20 dB down: a tenth
  expect(lowAmplitude(db, 43)).toBeCloseTo(0.1);
  db.fill(-10, 0, 4); // 20 dB over maxDecibels: ten, where a byte would have clipped
  expect(lowAmplitude(db, 43)).toBeCloseTo(10);
  db.fill(Number.NEGATIVE_INFINITY); // silence
  expect(lowAmplitude(db, 43)).toBe(0);
});

it('binRange: the bins between two frequencies, clamped to the spectrum', () => {
  expect(binRange(512, 43, 20, 150)).toEqual([0, 4]);
  expect(binRange(512, 46.875, 150, 2000)).toEqual([3, 43]);
  expect(binRange(8, 43, 2000, 8000)).toEqual([46, 8]); // empty
});

it('feeds secret mode’s beat tracker from the same samples', () => {
  const { beats, strong } = kicksOver(-70, -40, byteAverage);
  expect(beats.at(-1)).toBeGreaterThanOrEqual(3500);
  expect(strong).toBeGreaterThanOrEqual(3);
});

it('finds kicks over a held bass, where the dB-scaled bytes are too compressed to show them', () => {
  // A held bass at -45 dB, a kick to -30 dB: bytes 200 → 255, a rise of only 1.28×.
  const { beats, strong, oldBeats } = kicksOver(-45, -30, byteAverage);
  expect(oldBeats).toBe(0); // the byte average never clears BEAT.ratio
  expect(beats).toHaveLength(7); // 500 … 3500
  expect(strong).toBe(7);
  for (const [k, t] of beats.entries()) expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60);
});

it('finds kicks in a loud master, where the bytes clip at maxDecibels', () => {
  // A hot master: the 808 held at -18 dB, the kick to -8 dB. Both are over -30 dB, so every byte reads 255.
  const { beats, strong, oldBeats } = kicksOver(-18, -8, byteAmplitude);
  expect(oldBeats).toBe(0); // the clipped bytes are flat: nothing to find
  expect(beats).toHaveLength(7);
  expect(strong).toBe(7);
  for (const [k, t] of beats.entries()) expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60);
});
