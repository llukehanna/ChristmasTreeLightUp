import { expect, it } from 'vitest';
import { GameClock } from '../../../src/core/clock';

it('accumulates only while running', () => {
  const c = new GameClock();
  expect(c.elapsedMs(500)).toBe(0);
  c.resume(1000);
  expect(c.elapsedMs(1500)).toBe(500);
  c.pause(1500);
  expect(c.elapsedMs(3000)).toBe(500);
  c.resume(4000);
  expect(c.elapsedMs(4200)).toBe(700);
  expect(c.running).toBe(true);
});

it('starts from a restored elapsed time', () => {
  const c = new GameClock(2000);
  c.resume(0);
  expect(c.elapsedMs(250)).toBe(2250);
});
