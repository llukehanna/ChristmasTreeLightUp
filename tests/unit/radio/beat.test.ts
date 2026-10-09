import { describe, expect, it } from 'vitest';
import { BEAT, BeatTracker, RESTART_GAP_MS, beatStrength } from '../../../src/radio/beat';

/**
 * Onset flux (src/radio/lightshow.ts onsetFlux, dB of rise) as the real analyser gives it: `kick` on the first frame
 * of each beat (or `kicks[k]` for the k-th), a pad's wobble (up to `noise`) otherwise, sampled at `fps`.
 */
function flux(fps: number, ms: number, { bpm = 120, kick = 12, kicks = [] as number[], noise = 2 } = {}): [number, number][] {
  const period = 60_000 / bpm;
  const out: [number, number][] = [];
  let s = 3;
  let beat = -1;
  for (let k = 0, t = 0; t < ms; k++, t = (k * 1000) / fps) {
    const n = Math.floor(t / period);
    const first = n !== beat;
    beat = n;
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push([t, first ? (kicks.length ? kicks[n % kicks.length] : kick) : (noise * s) / 2 ** 32]);
  }
  return out;
}
const onsets = (b: BeatTracker, samples: [number, number][]) => samples.filter(([t, e]) => b.update(e, t)).map(([t]) => t);

describe('BeatTracker', () => {
  it('finds every kick after the warm-up, on its first frame', () => {
    const at = onsets(new BeatTracker(), flux(60, 4000));
    expect(at).toHaveLength(7); // 500 … 3500; the kick at 0 is inside the warm-up
    at.forEach((t, k) => expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60));
  });

  it('finds the same beats at 30 and 60 frames a second', () => {
    const a = onsets(new BeatTracker(), flux(60, 6000));
    const b = onsets(new BeatTracker(), flux(30, 6000));
    expect(b).toHaveLength(a.length);
    b.forEach((t, k) => expect(Math.abs(t - a[k])).toBeLessThanOrEqual(34));
  });

  it('keeps 250 ms between beats however fast the kicks come', () => {
    const at = onsets(new BeatTracker(), flux(60, 3000, { bpm: 300 }));
    expect(at.length).toBeGreaterThan(3);
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(BEAT.refractoryMs);
  });

  it('ignores anything under the floor: a pad’s wobble, a soft hit', () => {
    expect(onsets(new BeatTracker(), flux(60, 4000, { kick: 0, noise: BEAT.floor - 0.01 }))).toEqual([]);
    expect(onsets(new BeatTracker(), flux(60, 4000, { kick: BEAT.floor - 0.5 }))).toEqual([]);
  });

  it('a steady wash of flux (noise, applause) is no beat: it must jump over the recent average', () => {
    expect(onsets(new BeatTracker(), flux(60, 4000, { kick: 9, noise: 0 }).map(([t]) => [t, 9] as [number, number]))).toEqual([]);
  });

  it('strength is relative to the song’s recent beats: equal kicks are all strong, however soft or loud the master', () => {
    for (const kick of [2 * BEAT.floor, 12, 40]) {
      const b = new BeatTracker();
      const n = onsets(b, flux(60, 4000, { kick })).length;
      expect(n).toBe(7);
      expect(b.strength).toBe(1);
      expect(b.strong).toBe(n);
    }
  });

  it('the bigger hits are strong and the smaller ones not: loud and soft kicks in turn', () => {
    const b = new BeatTracker();
    const strengths: number[] = [];
    for (const [t, e] of flux(60, 4000, { kicks: [20, 7] })) if (b.update(e, t)) strengths.push(b.strength);
    expect(strengths).toHaveLength(7); // 500 (soft) … 3500 (soft)
    // The loud ones at 1000, 2000 and 3000, and the first soft one (the song's peak until the first loud one).
    expect(strengths.filter((s) => s >= BEAT.strong)).toHaveLength(4);
    expect(b.strong).toBe(4);
    expect(strengths.slice(2).filter((_, k) => k % 2 === 0).every((s) => s < BEAT.strong)).toBe(true); // 1500, 2500, 3500
    expect(Math.min(...strengths)).toBeLessThan(BEAT.strong);
  });

  it('the peak fades: after a loud stretch, a quieter one’s kicks become strong again', () => {
    const b = new BeatTracker();
    onsets(b, flux(60, 2000, { kick: 40 }));
    const soft = flux(60, 12_000, { kick: 8 }).filter(([t]) => t >= 2000);
    const strengths: number[] = [];
    for (const [t, e] of soft) if (b.update(e, t)) strengths.push(b.strength);
    expect(strengths[0]).toBeLessThan(BEAT.strong);
    expect(strengths.at(-1)).toBeGreaterThanOrEqual(BEAT.strong);
  });

  it('reset forgets the beat, the strong count, the peak and the average, and warms up again', () => {
    const b = new BeatTracker();
    onsets(b, flux(60, 2000, { kick: 40 }));
    expect(b.strong).toBeGreaterThan(0);
    b.reset();
    expect([b.at, b.strength, b.strong]).toEqual([Number.NEGATIVE_INFINITY, 0, 0]);
    expect(b.update(0.5, 10_000)).toBe(false);
    expect(b.update(12, 10_200)).toBe(false); // clears every threshold, but still warming up
    expect(b.update(0.5, 10_300)).toBe(false);
    expect(b.update(12, 10_400)).toBe(true); // warmed up
    expect(b.strength).toBe(1); // the old loud peak is forgotten
  });

  it('a clock that goes backwards starts the warm-up again, and forgets beats now in its future', () => {
    const b = new BeatTracker();
    onsets(b, flux(60, 10_050));
    expect(b.at).toBeGreaterThanOrEqual(10_000);
    expect(b.update(0.5, 5)).toBe(false); // backwards: a new start
    expect(b.update(12, 205)).toBe(false); // warming up
    expect(b.update(0.5, 305)).toBe(false);
    expect(b.update(12, 405)).toBe(true); // not blocked by the beat at 10 000
  });

  it('a long gap between samples starts the warm-up again', () => {
    const b = new BeatTracker();
    for (let t = 0; t <= 1000; t += 1000 / 60) b.update(0.5, t);
    expect(6000 - 1000).toBeGreaterThan(RESTART_GAP_MS);
    // Five seconds later the first sample (stale against the old frame) and its warm-up raise nothing.
    expect(b.update(30, 6000)).toBe(false);
    expect(b.update(12, 6200)).toBe(false);
  });
});

it('a marginal first onset is a weak beat: it is measured against a typical kick, not itself', () => {
  const b = new BeatTracker();
  for (const [t, e] of flux(60, 700, { kick: 0, noise: 0.5 })) b.update(e, t);
  expect(b.update(BEAT.floor * 1.04, 700)).toBe(true); // 4 % over the floor
  expect(b.strength).toBeLessThan(BEAT.strong);
  expect(b.strong).toBe(0);
});

describe('beatStrength', () => {
  it('0.3 at the floor, 1 at the recent peak (at least peakMin × the floor), on a log scale', () => {
    expect(beatStrength(BEAT.floor * 1.04, 0)).toBeLessThan(BEAT.strong);
    expect(beatStrength(BEAT.peakMin * BEAT.floor, 0)).toBe(1);
    expect(beatStrength(Math.sqrt(BEAT.floor * 20), 20)).toBeCloseTo(0.65); // halfway, in log terms
    expect(beatStrength(BEAT.floor, 20)).toBeCloseTo(0.3);
    expect(beatStrength(20, 20)).toBe(1);
    expect(beatStrength(30, 20)).toBe(1);
    expect(beatStrength(BEAT.floor, BEAT.floor)).toBeCloseTo(0.3);
    expect(beatStrength(BEAT.floor - 1, 20)).toBe(0.3);
  });
});
