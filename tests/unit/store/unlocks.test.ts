// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { lastPlayer, loadUnlocks, playerKey, saveUnlocks, type UnlockRecord } from '../../../src/store/unlocks';

beforeEach(() => localStorage.clear());

const rec = (earned: UnlockRecord['earned'], o: Partial<UnlockRecord> = {}): UnlockRecord => ({ earned, known: earned, seen: earned, synced: false, treesLit: 0, ...o });

it('a player is the guest or their account id', () => {
  expect(playerKey(null)).toBe('guest');
  expect(playerKey(42)).toBe('u42');
});

it('a record round-trips, one per player', () => {
  const ana = rec(['decor:tinsel', 'scene:midnight'], { known: ['decor:tinsel'], seen: [], synced: true, treesLit: 7 });
  saveUnlocks('u1', ana);
  saveUnlocks('guest', rec([]));
  expect(loadUnlocks('u1')).toEqual(ana);
  expect(loadUnlocks('guest')).toEqual(rec([]));
  expect(loadUnlocks('u2')).toBeNull();
});

it('keeps at most 10 players, dropping the one saved longest ago', () => {
  for (let i = 0; i < 10; i++) saveUnlocks(`u${i}`, rec([]));
  saveUnlocks('u0', rec(['decor:tinsel'])); // saved again: now the newest
  saveUnlocks('u10', rec([]));
  expect(loadUnlocks('u1')).toBeNull();
  expect(loadUnlocks('u0')).toEqual(rec(['decor:tinsel']));
  expect(Object.keys(JSON.parse(localStorage.getItem('aglow.unlocks')!))).toHaveLength(10);
});

it('tolerates older or garbled records', () => {
  localStorage.setItem('aglow.unlocks', JSON.stringify({
    u1: { earned: ['decor:tinsel', 'hat:top', 7], known: ['decor:tinsel'], seen: ['decor:tinsel'] },
    u2: { earned: ['decor:tinsel'] },
    u3: { earned: 'lots' },
    u4: null,
  }));
  // No flag: not synced; unknown items dropped; no trees count: 0.
  expect(loadUnlocks('u1')).toEqual(rec(['decor:tinsel']));
  // No known or seen: taken as all known and seen, so nothing is announced.
  expect(loadUnlocks('u2')).toEqual(rec(['decor:tinsel']));
  expect(loadUnlocks('u3')).toBeNull();
  expect(loadUnlocks('u4')).toBeNull();
  localStorage.setItem('aglow.unlocks', '[1,2]');
  expect(loadUnlocks('u1')).toBeNull();
  localStorage.setItem('aglow.unlocks', '{oops');
  expect(loadUnlocks('u1')).toBeNull();
  saveUnlocks('u1', rec([])); // a garbled store is replaced, not added to
  expect(loadUnlocks('u1')).toEqual(rec([]));
});

it('the last player saved on this device, if any', () => {
  expect(lastPlayer()).toBeUndefined();
  saveUnlocks('u3', rec([]));
  expect(lastPlayer()).toBe(3);
  saveUnlocks('guest', rec([]));
  expect(lastPlayer()).toBeNull();
  saveUnlocks('u3', rec([]));
  expect(lastPlayer()).toBe(3);
});
