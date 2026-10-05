import { expect, it } from 'vitest';
import { BeatDetector, LightShow, bandEnergies } from '../../../src/radio/lightshow';

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
