import { expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { nextIndex, prevIndex, shuffled } from '../../../src/radio/queue';

it('shuffles without losing or duplicating tracks', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const q = shuffled(items, mulberry32(1));
  expect([...q].sort((a, b) => a - b)).toEqual(items);
  expect(q).not.toEqual(items);
});
it('wraps next, and restarts on prev after 3 seconds', () => {
  expect(nextIndex(4, 5)).toBe(0);
  expect(prevIndex(0, 5, 1)).toBe(4);
  expect(prevIndex(2, 5, 10)).toBe(2);
});
