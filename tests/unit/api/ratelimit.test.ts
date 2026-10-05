import { expect, it } from 'vitest';
import { RateLimiter } from '../../../api/_lib/ratelimit';

it('allows up to max attempts per window, per key', () => {
  const r = new RateLimiter(3, 1000);
  expect([1, 2, 3, 4].map(() => r.allow('ip', 0))).toEqual([true, true, true, false]);
  expect(r.allow('other', 0)).toBe(true);
  expect(r.allow('ip', 1001)).toBe(true);
});
