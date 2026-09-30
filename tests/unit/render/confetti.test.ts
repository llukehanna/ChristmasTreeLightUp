import { expect, it } from 'vitest';
import { CONFETTI_COUNT, CONFETTI_MS, Confetti } from '../../../src/render/effects';

it('falls only for a few seconds after the win', () => {
  const c = new Confetti();
  expect(c.count(1000, null, 1)).toBe(0);
  expect(c.count(900, 1000, 1)).toBe(0);
  expect(c.count(1000 + CONFETTI_MS / 2, 1000, 1)).toBe(CONFETTI_COUNT);
  expect(c.count(1000 + CONFETTI_MS + 1, 1000, 1)).toBe(0);
});

it('halves with the quality governor like snow', () => {
  const c = new Confetti();
  expect(c.count(2000, 1000, 0.5)).toBe(CONFETTI_COUNT / 2);
});
