import { expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { crossfadeLength, equalPowerCurve, seamlessBrownNoise } from '../../../src/radio/dsp';

const maxStep = (d: Float32Array): number => {
  let m = 0;
  for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1]));
  return m;
};

it('brown noise loops with no step at the wrap point', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const d = seamlessBrownNoise(48000, mulberry32(seed));
    const wrap = Math.abs(d[0] - d[d.length - 1]);
    expect(wrap).toBeLessThanOrEqual(maxStep(d));
    expect(wrap).toBeLessThan(1e-4);
  }
});

it('brown noise keeps a sensible level and stays finite', () => {
  const d = seamlessBrownNoise(96000, mulberry32(9));
  let s = 0;
  for (const v of d) {
    expect(Number.isFinite(v)).toBe(true);
    s += v * v;
  }
  const rms = Math.sqrt(s / d.length);
  expect(rms).toBeGreaterThan(0.05);
  expect(rms).toBeLessThan(0.6);
});

it('equal-power fades sum to constant power and hit their endpoints', () => {
  const steps = 48;
  const fin = equalPowerCurve(0, 1, steps);
  const fout = equalPowerCurve(1, 0, steps);
  expect(fin[0]).toBeCloseTo(0);
  expect(fin[steps]).toBeCloseTo(1);
  expect(fout[0]).toBeCloseTo(1);
  expect(fout[steps]).toBeCloseTo(0);
  for (let k = 0; k <= steps; k++) expect(fin[k] ** 2 + fout[k] ** 2).toBeCloseTo(1, 5);
  // midpoint is -3 dB each, not -6 dB as with a linear crossfade
  expect(fin[steps / 2]).toBeCloseTo(Math.SQRT1_2, 5);
});

it('equal-power curves are monotonic and start from a partial level', () => {
  const c = equalPowerCurve(0.4, 1, 16);
  expect(c[0]).toBeCloseTo(0.4);
  for (let k = 1; k < c.length; k++) expect(c[k]).toBeGreaterThanOrEqual(c[k - 1]);
  const d = equalPowerCurve(0.6, 0, 16);
  expect(d[0]).toBeCloseTo(0.6);
  for (let k = 1; k < d.length; k++) expect(d[k]).toBeLessThanOrEqual(d[k - 1]);
});

it('the crossfade never outlasts the outgoing track', () => {
  expect(crossfadeLength(10, 3)).toBe(3);
  expect(crossfadeLength(2, 3)).toBeCloseTo(1.95);
  expect(crossfadeLength(0.1, 3)).toBe(0.25);
  expect(crossfadeLength(Number.NaN, 3)).toBe(3);
});
