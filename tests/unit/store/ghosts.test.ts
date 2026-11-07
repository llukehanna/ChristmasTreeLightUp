// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GhostRun } from '../../../src/api/types';
import { MAX_FACTS_ENTRIES } from '../../../src/core/facts';
import { GRID } from '../../../src/core/mask';
import { ghostOn, loadGhost, offerGhost, pickGhost, setGhostOn } from '../../../src/store/ghosts';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const tile = GRID.ids[0];
const run = (ms: number, over: Partial<GhostRun> = {}): GhostRun => ({ seed: 7, genVersion: 2, log: [{ t: 1000, a: tile }], ms, ...over });
const tree = { seed: 7, genVersion: 2 };

it("pickGhost never picks a run from another tree (another genVersion, or a stored day whose seed differs), and picks the faster of two that match", () => {
  expect(pickGhost(tree, run(40_000, { genVersion: 1 }))).toBeNull();
  expect(pickGhost(tree, run(40_000, { seed: 8 }))).toBeNull();
  expect(pickGhost(tree, null, null)).toBeNull();
  expect(pickGhost(tree)).toBeNull();
  const slow = run(52_000);
  const fast = run(48_000);
  expect(pickGhost(tree, slow, fast)).toBe(fast);
  expect(pickGhost(tree, fast, slow)).toBe(fast);
  // A faster run from another tree loses to a slower one from this tree.
  expect(pickGhost(tree, slow, run(30_000, { genVersion: 3 }), null)).toBe(slow);
});

it('offerGhost keeps the faster run for a day', () => {
  expect(loadGhost('2026-11-06')).toBeNull();
  offerGhost('2026-11-06', run(52_000));
  expect(loadGhost('2026-11-06')?.ms).toBe(52_000);
  offerGhost('2026-11-06', run(55_000));
  expect(loadGhost('2026-11-06')?.ms).toBe(52_000);
  offerGhost('2026-11-06', run(48_000));
  expect(loadGhost('2026-11-06')).toEqual(run(48_000));
  expect(loadGhost('2026-11-05')).toBeNull();
});

it('offerGhost keeps at most 31 days, the oldest going first', () => {
  const day = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
  // Offered out of order: what goes is the oldest day, not the first offered.
  for (let i = 31; i >= 1; i--) offerGhost(day(i), run(40_000 + i));
  expect(loadGhost(day(1))?.ms).toBe(40_001);
  offerGhost(day(0), run(40_000));
  expect(loadGhost(day(0))).toBeNull();
  offerGhost(day(32), run(40_032));
  expect(loadGhost(day(32))?.ms).toBe(40_032);
  expect(loadGhost(day(1))).toBeNull();
  expect(loadGhost(day(2))?.ms).toBe(40_002);
  expect(Object.keys(JSON.parse(localStorage.getItem('aglow.ghosts')!))).toHaveLength(31);
});

it('offerGhost skips a log longer than MAX_FACTS_ENTRIES', () => {
  const log = Array.from({ length: MAX_FACTS_ENTRIES + 1 }, (_, i) => ({ t: 1000 + i, a: tile }));
  offerGhost('2026-11-06', run(48_000, { log }));
  expect(loadGhost('2026-11-06')).toBeNull();
  offerGhost('2026-11-06', run(48_000, { log: log.slice(0, MAX_FACTS_ENTRIES) }));
  expect(loadGhost('2026-11-06')?.log).toHaveLength(MAX_FACTS_ENTRIES);
});

it('a corrupt store or entry is no ghost, and a good offer replaces it', () => {
  localStorage.setItem('aglow.ghosts', '{not json');
  expect(loadGhost('2026-11-06')).toBeNull();
  localStorage.setItem('aglow.ghosts', JSON.stringify({ '2026-11-06': { seed: 7, genVersion: 2, log: [{ t: -1, a: 'x' }], ms: 48_000 } }));
  expect(loadGhost('2026-11-06')).toBeNull();
  localStorage.setItem('aglow.ghosts', JSON.stringify({ '2026-11-06': { seed: '7', genVersion: 2, log: [], ms: 48_000 } }));
  expect(loadGhost('2026-11-06')).toBeNull();
  offerGhost('2026-11-06', run(60_000));
  expect(loadGhost('2026-11-06')?.ms).toBe(60_000);
});

it('blocked storage: no ghost, and nothing throws', () => {
  offerGhost('2026-11-06', run(48_000));
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(loadGhost('2026-11-06')).toBeNull();
  expect(() => offerGhost('2026-11-07', run(48_000))).not.toThrow();
  expect(ghostOn()).toBe(true);
  expect(() => setGhostOn(false)).not.toThrow();
  expect(() => setGhostOn(true)).not.toThrow();
});

it("the ghost is on by default, and remembered per device ('0' is off)", () => {
  expect(ghostOn()).toBe(true);
  setGhostOn(false);
  expect(localStorage.getItem('aglow.ghost')).toBe('0');
  expect(ghostOn()).toBe(false);
  setGhostOn(true);
  expect(ghostOn()).toBe(true);
  localStorage.setItem('aglow.ghost', 'garbage');
  expect(ghostOn()).toBe(true);
});
