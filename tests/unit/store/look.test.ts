// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { effectiveLook, NO_DECOR, STARTER_LOOK, loadLook, parseLook, saveLook, worldLook, type Look } from '../../../src/store/look';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it('a fresh device gets exactly the starter set', () => {
  expect(loadLook()).toEqual(STARTER_LOOK);
  expect(STARTER_LOOK).toMatchObject({ scene: 'fireside', path: 'filament', palette: 'scene', topper: 'snowflake', presents: 'none', decor: NO_DECOR });
});
it('a device with v1 settings keeps its scene, path, star and presents; Auto becomes Fireside', () => {
  localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'auto', pathStyle: 'neon', effectsVolume: 0.5, haptics: false }));
  expect(loadLook()).toMatchObject({ scene: 'fireside', path: 'neon', topper: 'star', presents: 'game' });
  expect(JSON.parse(localStorage.getItem('aglow.look')!)).toMatchObject({ path: 'neon' });
});
it('a device that has played but never saved a setting keeps the star and the presents, at Fireside on filament', () => {
  const returning: Look = { ...STARTER_LOOK, topper: 'star', presents: 'game' };
  for (const key of ['aglow.stats', 'aglow.game', 'aglow.settings', 'aglow.radio']) {
    localStorage.clear();
    localStorage.setItem(key, '{}');
    expect(loadLook(), key).toEqual(returning);
  }
  // Back from Google mid-save ("Save to leaderboard"): a returning player too.
  localStorage.clear();
  sessionStorage.setItem('aglow.return', 'g1');
  expect(loadLook()).toEqual(returning);
});
it('nothing saved: the starter look (a saved look alone is no play data)', () => {
  expect(loadLook()).toEqual(STARTER_LOOK);
  localStorage.clear();
  localStorage.setItem('aglow.return', 'g1');
  expect(loadLook()).toEqual(STARTER_LOOK);
});
it('a v1 scene other than Auto carries over', () => {
  localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'frost', pathStyle: 'fairy', effectsVolume: 0.5, haptics: false }));
  expect(loadLook()).toMatchObject({ scene: 'frost', path: 'fairy' });
});
it('a saved look wins over the settings, and round-trips', () => {
  localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'frost', pathStyle: 'fairy', effectsVolume: 0.5, haptics: false }));
  const mine: Look = { ...STARTER_LOOK, scene: 'midnight', palette: 'ice', decor: { ...NO_DECOR, beads: true } };
  saveLook(mine);
  expect(loadLook()).toEqual(mine);
});
it('a bad field falls back alone', () => {
  expect(parseLook({ ...STARTER_LOOK, palette: 'honey', topper: 'tree', path: 'neon', decor: undefined }))
    .toEqual({ ...STARTER_LOOK, path: 'neon' });
  expect(parseLook('junk')).toEqual(STARTER_LOOK);
});
it('every scene the drawer offers survives a reload', () => {
  for (const scene of ['midnight', 'fireside', 'frost', 'sash', 'square', 'parlour'] as const) {
    saveLook({ ...STARTER_LOOK, scene });
    expect(loadLook().scene).toBe(scene);
  }
});
it('a bad decor flag falls back alone', () => {
  expect(parseLook({ ...STARTER_LOOK, decor: { tinsel: true, beads: 'yes' } }).decor).toEqual({ ...NO_DECOR, tinsel: true });
});
it('the egg worlds keep the scene, path and topper and drop the rest; Home Alone has the star', () => {
  const mine: Look = { ...STARTER_LOOK, palette: 'gilded', decor: { ...NO_DECOR, skirt: true }, presents: 'luxe', path: 'neon' };
  expect(worldLook(mine, null)).toBe(mine);
  expect(worldLook(mine, 'secret')).toEqual({ ...mine, palette: 'scene', decor: NO_DECOR, presents: 'game' });
  expect(worldLook(mine, 'home-alone')).toEqual({ ...mine, palette: 'scene', decor: NO_DECOR, presents: 'game', topper: 'star' });
});
it('effectiveLook shows only owned slots and never touches the saved look', () => {
  const saved = { ...STARTER_LOOK, scene: 'sash', path: 'neon', topper: 'star', presents: 'game' } as Look;
  const l = effectiveLook(saved, (id) => ['scene:sash', 'presents:game'].includes(id));
  expect([l.scene, l.path, l.topper, l.presents]).toEqual(['sash', 'filament', 'snowflake', 'game']);
  expect(saved.path).toBe('neon');
});
it('effectiveLook: starter values need no item, a palette falls back alone, and each decoration needs its own', () => {
  expect(effectiveLook(STARTER_LOOK, () => false)).toEqual(STARTER_LOOK);
  const saved: Look = { ...STARTER_LOOK, palette: 'gilded', decor: { tinsel: true, beads: true, canes: false, skirt: true } };
  const l = effectiveLook(saved, (id) => id === 'decor:tinsel' || id === 'decor:canes');
  expect(l).toEqual({ ...STARTER_LOOK, decor: { ...NO_DECOR, tinsel: true } });
  expect(effectiveLook(saved, () => true)).toEqual(saved);
});
