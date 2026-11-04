import { expect, it } from 'vitest';
import { D, L, R, U } from '../../../src/core/dirs';
import { bulbAngle } from '../../../src/render/bulbs';
import { easeSnap } from '../../../src/render/effects';
import { PATH_STYLES, neonFlicker, twinklePhase } from '../../../src/render/paths';

it('offers exactly the three approved light paths', () => {
  expect(PATH_STYLES).toEqual(['filament', 'fairy', 'neon']);
});
it('neon stutters on for ~260ms then holds steady', () => {
  expect(neonFlicker(40)).toBeLessThan(1);
  expect(neonFlicker(300)).toBe(1);
  expect(neonFlicker(-5)).toBe(1);
});
it('points a bulb socket along its wire', () => {
  expect(bulbAngle(U)).toBeCloseTo(-Math.PI / 2);
  expect(bulbAngle(D)).toBeCloseTo(Math.PI / 2);
  expect(bulbAngle(L)).toBeCloseTo(Math.PI);
  expect(bulbAngle(R)).toBe(0);
});
it('snap easing ends exactly at 1 with a slight overshoot before', () => {
  expect(easeSnap(1)).toBeCloseTo(1);
  expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map(easeSnap))).toBeGreaterThan(1);
});
it('twinkle = 2 advances the fairy twinkle phase twice as fast as twinkle = 1', () => {
  const at = (now: number, twinkle: number) => twinklePhase(now, 3, 5, twinkle);
  expect(at(1000, 2) - at(0, 2)).toBeCloseTo(2 * (at(1000, 1) - at(0, 1)));
  expect(at(1000, 1) - at(0, 1)).toBeCloseTo(1000 * 0.0035);
});
