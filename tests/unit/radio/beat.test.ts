import { describe, expect, it } from 'vitest';
import { BEAT, BeatTracker, RESTART_GAP_MS, beatStrength } from '../../../src/radio/beat';

/** Low-band energy for a kick drum: `kick` for the first 60 ms of each beat, `floor` otherwise, sampled at `fps`. */
function kicks(fps: number, ms: number, { bpm = 120, kick = 0.8, floor = 0.15 } = {}): [number, number][] {
  const period = 60_000 / bpm;
  const out: [number, number][] = [];
  for (let k = 0, t = 0; t < ms; k++, t = (k * 1000) / fps) out.push([t, t % period < 60 ? kick : floor]);
  return out;
}
const onsets = (b: BeatTracker, samples: [number, number][]) => samples.filter(([t, e]) => b.update(e, t)).map(([t]) => t);

describe('BeatTracker', () => {
  it('finds every kick after the warm-up, on its first frame', () => {
    const at = onsets(new BeatTracker(), kicks(60, 4000));
    expect(at).toHaveLength(7); // 500 … 3500; the kick at 0 is inside the warm-up
    at.forEach((t, k) => expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60));
  });

  it('finds the same beats at 30 and 60 frames a second', () => {
    const a = onsets(new BeatTracker(), kicks(60, 6000));
    const b = onsets(new BeatTracker(), kicks(30, 6000));
    expect(b).toHaveLength(a.length);
    b.forEach((t, k) => expect(Math.abs(t - a[k])).toBeLessThanOrEqual(34));
  });

  it('keeps 250 ms between beats however fast the kicks come', () => {
    const at = onsets(new BeatTracker(), kicks(60, 3000, { bpm: 300 }));
    expect(at.length).toBeGreaterThan(3);
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(BEAT.refractoryMs);
  });

  it('ignores music too quiet to drive anything', () => {
    expect(onsets(new BeatTracker(), kicks(60, 3000, { kick: 0.05, floor: 0.01 }))).toEqual([]);
  });

  it('counts strong beats, and weak ones as beats but not strong', () => {
    const loud = new BeatTracker();
    const n = onsets(loud, kicks(60, 4000)).length;
    expect(loud.strong).toBe(n);
    expect(loud.strength).toBe(1);
    const soft = new BeatTracker();
    expect(onsets(soft, kicks(60, 4000, { kick: 0.26 })).length).toBeGreaterThan(3);
    expect(soft.strong).toBe(0);
    expect(soft.strength).toBeLessThan(BEAT.strong);
  });

  it('reset forgets the beat, the strong count and the average, and warms up again', () => {
    const b = new BeatTracker();
    onsets(b, kicks(60, 2000));
    expect(b.strong).toBeGreaterThan(0);
    b.reset();
    expect([b.at, b.strength, b.strong]).toEqual([Number.NEGATIVE_INFINITY, 0, 0]);
    expect(b.update(0.1, 10_000)).toBe(false);
    expect(b.update(0.5, 10_200)).toBe(false); // clears every threshold, but still warming up
    expect(b.update(0.1, 10_300)).toBe(false);
    expect(b.update(0.5, 10_400)).toBe(true); // warmed up
  });

  it('a clock that goes backwards starts the warm-up again', () => {
    const b = new BeatTracker();
    onsets(b, kicks(60, 2000));
    expect(b.update(0.1, 5)).toBe(false); // backwards: a new start
    expect(b.update(0.8, 205)).toBe(false); // warming up
  });

  it('a long gap between samples starts the warm-up again: the old average is stale', () => {
    const b = new BeatTracker();
    for (let t = 0; t <= 1000; t += 1000 / 60) b.update(0.1, t);
    expect(6000 - 1000).toBeGreaterThan(RESTART_GAP_MS);
    // Five seconds later the music is loud and steady: no beat from the stale quiet average.
    const at = onsets(b, kicks(60, 1000).map(([t]) => [6000 + t, 0.5] as [number, number]));
    expect(at).toEqual([]);
  });
});

describe('beatStrength', () => {
  it('0.3 at the threshold, 1 from 2.5 times the average', () => {
    expect(beatStrength(0.13, 0.1)).toBeCloseTo(0.3);
    expect(beatStrength(0.19, 0.1)).toBeCloseTo(0.65);
    expect(beatStrength(0.25, 0.1)).toBeCloseTo(1);
    expect(beatStrength(1, 0.1)).toBe(1);
    expect(beatStrength(0.1, 0)).toBe(1); // a floor under the average
  });
});
