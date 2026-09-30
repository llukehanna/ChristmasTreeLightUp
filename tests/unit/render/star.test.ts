import { expect, it } from 'vitest';
import { starState } from '../../../src/render/effects';

it('pulses the win star, but holds it steady under reduced motion', () => {
  const at = (now: number, reduced: boolean) => starState(now, 0, 1, reduced).glow;
  expect(at(2000, false)).not.toBeCloseTo(at(2500, false), 3);
  expect(at(2000, true)).toBe(at(2500, true));
  expect(at(2000, true)).toBeCloseTo(1, 6);
});
