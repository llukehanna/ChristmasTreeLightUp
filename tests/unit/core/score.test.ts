import { expect, it } from 'vitest';
import { formatTime, scoreFor, wholeSeconds } from '../../../src/core/score';

it('scores like the original: 50000 - 100 × seconds', () => {
  expect(scoreFor(84)).toBe(41600);
  expect(scoreFor(0)).toBe(50000);
});
it('formats whole seconds as m:ss', () => {
  expect(formatTime(84)).toBe('1:24');
  expect(formatTime(5)).toBe('0:05');
  expect(formatTime(600)).toBe('10:00');
});
it('floors milliseconds to whole seconds', () => {
  expect(wholeSeconds(84999)).toBe(84);
});
