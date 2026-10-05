import { expect, it } from 'vitest';
import { GLOBAL_KEY, RateLimiter } from '../../../api/_lib/ratelimit';

it('allows up to max attempts per window, per key', () => {
  const r = new RateLimiter(3, 1000);
  expect([1, 2, 3, 4].map(() => r.allow('ip', 0))).toEqual([true, true, true, false]);
  expect(r.allow('other', 0)).toBe(true);
  expect(r.allow('ip', 1001)).toBe(true);
});

it('counts a request at exactly the reset time in the old window, and opens a new one just after', () => {
  const r = new RateLimiter(1, 1000);
  expect(r.allow('ip', 0)).toBe(true);
  expect(r.allow('ip', 1000)).toBe(false);
  expect(r.allow('ip', 1001)).toBe(true);
});

it('bounds memory: sweeps expired keys first, then evicts the oldest, never clearing everything', () => {
  const r = new RateLimiter(1, 1000, 3);
  r.allow('a', 0);
  r.allow('b', 0);
  r.allow('c', 500);
  expect(r.size).toBe(3);
  // d arrives after a and b expired (reset 1000) but c is still live: the sweep alone is enough.
  r.allow('d', 1001);
  expect(r.size).toBe(2);
  expect(r.allow('c', 1002)).toBe(false); // c survived with its count
  r.allow('e', 1003);
  expect(r.size).toBe(3);
  // Nothing has expired: the oldest (c) goes, the rest stay.
  r.allow('f', 1004);
  expect(r.size).toBe(3);
  expect(r.allow('d', 1005)).toBe(false); // d is still limited
  expect(r.allow('c', 1005)).toBe(true); // c was evicted, so it starts fresh
});

it('serves a global limiter under GLOBAL_KEY', () => {
  const g = new RateLimiter(2, 1000);
  expect([1, 2, 3].map(() => g.allow(GLOBAL_KEY, 0))).toEqual([true, true, false]);
});
