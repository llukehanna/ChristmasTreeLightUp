// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { ProgressResponse } from '../../src/api/types';
import { ITEMS, type ItemId } from '../../src/core/catalogue';
import { evaluate, pileOf } from '../../src/core/goals';
import { effectiveLook, STARTER_LOOK, type Look } from '../../src/store/look';
import { loadUnlocks, saveUnlocks } from '../../src/store/unlocks';
import { previewAll, UnlockState } from '../../src/unlock-state';

beforeEach(() => localStorage.clear());

/** The server's answer for `treesLit` trees, plus `extra` earned items. */
const progress = (treesLit: number, extra: ItemId[] = []): ProgressResponse => {
  const e = evaluate({ treesLit, runs: [], topTenDays: 0 });
  return { earned: [...e.earned, ...extra], goals: e.goals, treesLit };
};
const state = () => {
  const onChange = vi.fn();
  return { s: new UnlockState({ onChange }), onChange };
};

it('a new key seeds known and seen silently: nothing is fresh on launch day', () => {
  // Review Focus 2: a guest with 12 trees, and the look they saved before unlocks.
  const { s } = state();
  s.setPlayer(null, 12);
  expect(['decor:tinsel', 'presents:game', 'scene:sash'].every((id) => s.owns(id as ItemId))).toBe(true);
  expect(s.owns('path:neon')).toBe(false);
  expect(s.fresh()).toEqual([]);
  expect(s.unseen()).toEqual([]);
  const saved: Look = { ...STARTER_LOOK, scene: 'sash', path: 'neon', topper: 'star', presents: 'game' };
  const l = effectiveLook(saved, (id) => s.owns(id));
  expect([l.scene, l.path, l.topper, l.presents]).toEqual(['sash', 'filament', 'snowflake', 'game']);
  expect(pileOf(s.treesLit(), 6)).toBe(2);
  // The same for a signed-in player: their first server set is theirs already, not news.
  const { s: t } = state();
  t.setPlayer(7, 12);
  t.setServer(progress(12, ['topper:star']));
  expect(t.owns('topper:star')).toBe(true);
  expect(t.fresh()).toEqual([]);
  expect(t.unseen()).toEqual([]);
});

it('a new device before progress: the device set (and any cached set) only; the server set then adds without re-announcing what was cached', () => {
  const saved: Look = { ...STARTER_LOOK, scene: 'midnight', topper: 'star' };
  // No cached set: this device's 3 trees earn the tinsel, and nothing else, until the progress arrives.
  const { s, onChange } = state();
  s.setPlayer(8, 3);
  expect(s.owns('decor:tinsel')).toBe(true);
  expect(effectiveLook(saved, (id) => s.owns(id))).toMatchObject({ scene: 'fireside', topper: 'snowflake' });
  onChange.mockClear();
  s.setServer(progress(30, ['topper:star']));
  expect(onChange).toHaveBeenCalledOnce();
  expect(effectiveLook(saved, (id) => s.owns(id))).toMatchObject({ scene: 'midnight', topper: 'star' });
  expect(saved).toMatchObject({ scene: 'midnight', topper: 'star' });
  expect(s.fresh()).toEqual([]);

  // A cached set: shown at once; a server set adding to it announces only what is new.
  saveUnlocks('u9', { earned: ['scene:midnight', 'topper:star'], known: ['scene:midnight', 'topper:star'], seen: ['scene:midnight', 'topper:star'], synced: true, treesLit: 30 });
  const { s: t, onChange: changed } = state();
  t.setPlayer(9, 0);
  expect(t.owns('topper:star')).toBe(true);
  expect(t.treesLit()).toBe(30);
  expect(t.fresh()).toEqual([]);
  changed.mockClear();
  t.setServer(progress(31, ['topper:star', 'palette:candy']));
  expect(changed).toHaveBeenCalledOnce();
  expect(t.fresh()).toContain('palette:candy');
  expect(t.fresh()).not.toContain('topper:star');
  expect(t.fresh()).not.toContain('scene:midnight');
});

it('fresh() lists earned-but-unknown items once, until markKnown', () => {
  const { s } = state();
  s.setPlayer(null, 0);
  expect(s.fresh()).toEqual([]);
  s.setPlayer(null, 1); // the first win
  expect(s.fresh()).toEqual(['decor:tinsel']);
  expect(s.fresh()).toEqual(['decor:tinsel']);
  s.markKnown(['decor:tinsel']);
  expect(s.fresh()).toEqual([]);
  // Seen is separate: the dot stays until the wardrobe is opened.
  expect(s.unseen()).toEqual(['decor:tinsel']);
  // Kept on the device.
  const { s: again } = state();
  again.setPlayer(null, 1);
  expect(again.fresh()).toEqual([]);
  expect(again.unseen()).toEqual(['decor:tinsel']);
  again.markSeen();
  expect(again.unseen()).toEqual([]);
  expect(loadUnlocks('guest')?.seen).toEqual(['decor:tinsel']);
});

it('treesLit is the larger of the server and the device', () => {
  const { s } = state();
  s.setPlayer(5, 40);
  s.setServer(progress(12));
  expect(s.treesLit()).toBe(40);
  expect(s.goal('m25')).toEqual({ have: 25, need: 25, done: true });
  s.setPlayer(5, 3);
  expect(s.treesLit()).toBe(12);
  s.setServer(progress(60));
  expect(s.treesLit()).toBe(60);
});

it('a guest tracks milestones only; other goals wait for an account', () => {
  const { s } = state();
  s.setPlayer(null, 7);
  expect(s.goal('m10')).toEqual({ have: 7, need: 10, done: false });
  expect(s.goal('s60')).toBeNull();
  s.setPlayer(4, 7);
  s.setServer(progress(7));
  expect(s.goal('s60')).toEqual({ have: 0, need: 60_000, done: false });
});

it('a failed progress fetch keeps the cached set', () => {
  const { s, onChange } = state();
  s.setPlayer(2, 0);
  s.setServer(progress(10));
  onChange.mockClear();
  s.setServer(null);
  expect(onChange).not.toHaveBeenCalled();
  expect(s.owns('scene:sash')).toBe(true);
  expect(s.treesLit()).toBe(10);
});

it('onChange fires only when the earned set or the trees lit change', () => {
  const { s, onChange } = state();
  s.setPlayer(null, 1);
  onChange.mockClear();
  s.setPlayer(null, 1);
  expect(onChange).not.toHaveBeenCalled();
  s.setPlayer(null, 2); // no new item, but one more tree towards the pile
  expect(onChange).toHaveBeenCalledOnce();
  s.markKnown(['decor:tinsel']);
  s.markSeen();
  expect(onChange).toHaveBeenCalledOnce();
});

it('switching players switches records; a signed-in player without an id has the device set only', () => {
  const { s } = state();
  s.setPlayer(1, 0);
  s.setServer(progress(50));
  expect(s.owns('scene:parlour')).toBe(true);
  s.setPlayer(null, 6); // signed out
  expect(s.owns('scene:parlour')).toBe(false);
  expect(s.owns('presents:game')).toBe(true);
  s.setPlayer(1, 6); // back: the cached set until the progress arrives
  expect(s.owns('scene:parlour')).toBe(true);
  expect(s.treesLit()).toBe(50);
  s.setPlayer(undefined, 6);
  expect(s.owns('scene:parlour')).toBe(false);
  expect(s.owns('presents:game')).toBe(true);
  s.setServer(progress(50)); // no key: nothing to keep it under
  expect(s.owns('scene:parlour')).toBe(false);
  expect(s.fresh()).toEqual([]);
  expect(Object.keys(JSON.parse(localStorage.getItem('aglow.unlocks')!)).sort()).toEqual(['guest', 'u1']);
});

it('?wardrobe=all is a dev build alone: it owns everything without earning, announcing or saving any of it', () => {
  expect(previewAll(true, '?wardrobe=all')).toBe(true);
  expect(previewAll(true, '?scene=frost&wardrobe=all')).toBe(true);
  // The production build: import.meta.env.DEV is false, whatever the address says.
  expect(previewAll(false, '?wardrobe=all')).toBe(false);
  expect(previewAll(true, '?wardrobe=some')).toBe(false);
  expect(previewAll(true, '')).toBe(false);
  const s = new UnlockState({ onChange: vi.fn() }, true);
  s.setPlayer(null, 0);
  expect(ITEMS.every((i) => s.owns(i.id))).toBe(true);
  expect(s.fresh()).toEqual([]);
  expect(s.unseen()).toEqual([]);
  expect(loadUnlocks('guest')!.earned).toEqual([]);
  // Without it, a new guest owns nothing.
  const { s: plain } = state();
  plain.setPlayer(null, 0);
  expect(ITEMS.some((i) => plain.owns(i.id))).toBe(false);
});
