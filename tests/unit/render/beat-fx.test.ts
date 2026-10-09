import { expect, it } from 'vitest';
import { NOD_MS, beatPulse, garlandBob, nodPulse } from '../../../src/render/beat-fx';

it('nodPulse: a quick dip to 1 at 30 % and a slower return to 0', () => {
  expect(nodPulse(-1)).toBe(0);
  expect(nodPulse(0)).toBe(0);
  expect(nodPulse(0.3 * NOD_MS)).toBeCloseTo(1);
  expect(nodPulse(NOD_MS)).toBe(0);
  expect(nodPulse(0.15 * NOD_MS)).toBeCloseTo(0.5);
  expect(nodPulse(0.65 * NOD_MS)).toBeCloseTo(0.5);
});

it('beatPulse: a bright flash that fades, gentler under reduced motion', () => {
  expect(beatPulse(-5, 1, false)).toBe(0);
  expect(beatPulse(0, 1, false)).toBeCloseTo(0.6);
  expect(beatPulse(180, 0.5, false)).toBeCloseTo(0.3 * Math.exp(-1));
  expect(beatPulse(0, 1, true)).toBeCloseTo(0.25);
  expect(beatPulse(250, 1, true)).toBeCloseTo(0.25 * Math.exp(-1));
});

it('garlandBob: a gentle idle sway plus a dip on the beat; still under reduced motion', () => {
  for (let t = 0; t < 5000; t += 97) expect(Math.abs(garlandBob(t, Number.NEGATIVE_INFINITY, 0, false))).toBeLessThanOrEqual(0.05);
  const now = 9000;
  expect(garlandBob(now, now - 0.3 * NOD_MS, 1, false) - garlandBob(now, Number.NEGATIVE_INFINITY, 0, false)).toBeCloseTo(0.16);
  expect(garlandBob(now, now - 0.3 * NOD_MS, 1, true)).toBe(0);
});
