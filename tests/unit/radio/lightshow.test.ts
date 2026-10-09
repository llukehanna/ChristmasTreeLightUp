import { expect, it } from 'vitest';
import { BeatTracker } from '../../../src/radio/beat';
import { BeatDetector, LightShow, bandEnergies, lowAmplitude } from '../../../src/radio/lightshow';

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

/** An analyser with the default dB range whose every bin reads `level()` (a byte). */
function fakeAnalyser(level: () => number): AnalyserNode {
  return {
    frequencyBinCount: 512,
    fftSize: 1024,
    minDecibels: -100,
    maxDecibels: -30,
    context: { sampleRate: 44_100 },
    getByteFrequencyData: (bins: Uint8Array) => bins.fill(level()),
  } as unknown as AnalyserNode;
}
/** The byte the analyser reports for `db` (minDecibels -100, maxDecibels -30). */
const byteOf = (db: number) => Math.round(((db + 100) / 70) * 255);

it('lowAmplitude: the low band as linear amplitude, 1 at maxDecibels', () => {
  const bins = new Uint8Array(512);
  bins.fill(255, 0, 4);
  expect(lowAmplitude(bins, 43, -100, -30)).toBeCloseTo(1);
  bins.fill(byteOf(-50), 0, 4); // 20 dB down: a tenth
  expect(lowAmplitude(bins, 43, -100, -30)).toBeCloseTo(0.1, 2);
  bins.fill(0);
  expect(lowAmplitude(bins, 43, -100, -30)).toBeLessThan(0.001);
});

it('feeds secret mode’s beat tracker from the same samples', () => {
  let level = 40;
  const show = new LightShow(() => fakeAnalyser(() => level));
  for (let t = 0; t <= 2000; t += 1000 / 60) {
    level = t % 500 < 60 ? 200 : 40;
    show.sample(t);
  }
  expect(show.beat.at).toBeGreaterThanOrEqual(1500);
  expect(show.beat.strong).toBeGreaterThanOrEqual(3);
});

it('finds kicks over a held bass, where the dB-scaled bytes are too compressed to show them', () => {
  // A held bass at -45 dB, a kick to -30 dB for 60 ms every 500 ms: bytes 200 → 255, a rise of only 1.28×.
  const kick = (t: number) => (t % 500 < 60 ? byteOf(-30) : byteOf(-45));
  const show = new LightShow(() => fakeAnalyser(() => kick(now)));
  const bytes = new BeatTracker();
  let now = 0;
  const beats: number[] = [];
  let byteBeats = 0;
  for (; now <= 4000; now += 1000 / 60) {
    const at = show.beat.at;
    show.sample(now);
    if (show.beat.at !== at) beats.push(now);
    if (bytes.update(kick(now) / 255, now)) byteBeats++;
  }
  expect(byteBeats).toBe(0); // the bytes (the old input) never clear BEAT.ratio
  expect(beats).toHaveLength(7); // 500 … 3500
  expect(show.beat.strong).toBe(7);
  for (const [k, t] of beats.entries()) expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60);
});
