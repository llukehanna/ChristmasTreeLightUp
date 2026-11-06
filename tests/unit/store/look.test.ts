// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { ITEMS } from '../../../src/core/catalogue';
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

it('the starter look hangs the game garland and the plain tag', () => {
  expect(STARTER_LOOK).toMatchObject({ garland: 'game', tag: 'plain' });
  expect(parseLook({ ...STARTER_LOOK, garland: undefined, tag: undefined })).toEqual(STARTER_LOOK);
});
it('parseLook keeps a valid garland and tag and drops unknown ones', () => {
  expect(parseLook({ ...STARTER_LOOK, garland: 'champagne', tag: 'velvet' })).toMatchObject({ garland: 'champagne', tag: 'velvet' });
  expect(parseLook({ ...STARTER_LOOK, garland: 'tinsel', tag: 7 })).toEqual(STARTER_LOOK);
});
it('parseLook accepts every value the catalogue names for a Look slot (the catalogue and the look cannot drift)', () => {
  const slots = ['scene', 'path', 'palette', 'topper', 'presents', 'garland', 'tag'] as const;
  const named = ITEMS.filter((i) => (slots as readonly string[]).includes(i.slot));
  expect(named.length).toBeGreaterThan(40);
  for (const i of named) expect(parseLook({ ...STARTER_LOOK, [i.slot]: i.value })[i.slot as (typeof slots)[number]], i.id).toBe(i.value);
});
it('effectiveLook locks the garland and the tag', () => {
  const saved: Look = { ...STARTER_LOOK, garland: 'gold', tag: 'holly' };
  expect(effectiveLook(saved, () => false)).toMatchObject({ garland: 'game', tag: 'plain' });
  expect(effectiveLook(saved, (id) => id === 'tag:holly')).toMatchObject({ garland: 'game', tag: 'holly' });
  expect(effectiveLook(saved, (id) => id === 'garland:gold')).toMatchObject({ garland: 'gold', tag: 'plain' });
  expect(saved).toMatchObject({ garland: 'gold', tag: 'holly' });
});
it('the egg worlds reset the garland and the tag too', () => {
  const mine: Look = { ...STARTER_LOOK, garland: 'pastel', tag: 'ember', palette: 'disco', topper: 'goldstar' };
  for (const w of ['secret', 'home-alone'] as const) expect(worldLook(mine, w)).toMatchObject({ garland: 'game', tag: 'plain', palette: 'scene' });
  expect(worldLook(mine, 'secret').topper).toBe('goldstar');
});

it('the starter look strings the game bulbs on the fir, with the plain cursor; parseLook keeps known strands, trees and cursors', () => {
  expect(STARTER_LOOK).toMatchObject({ strand: 'bulbs', tree: 'fir', cursor: 'plain' });
  expect(parseLook({ ...STARTER_LOOK, strand: 'candle', tree: 'tinsel', cursor: 'spark' })).toMatchObject({ strand: 'candle', tree: 'tinsel', cursor: 'spark' });
  expect(parseLook({ ...STARTER_LOOK, strand: 'icicle', tree: 7, cursor: undefined })).toEqual(STARTER_LOOK);
  for (const i of ITEMS.filter((x) => x.slot === 'strand' || x.slot === 'tree' || x.slot === 'cursor'))
    expect(parseLook({ ...STARTER_LOOK, [i.slot]: i.value })[i.slot as 'strand' | 'tree' | 'cursor'], i.id).toBe(i.value);
});
it('effectiveLook locks the strand, the tree and the cursor', () => {
  const saved: Look = { ...STARTER_LOOK, strand: 'bubble', tree: 'flocked', cursor: 'spark' };
  expect(effectiveLook(saved, () => false)).toMatchObject({ strand: 'bulbs', tree: 'fir', cursor: 'plain' });
  expect(effectiveLook(saved, (id) => id === 'strand:bubble')).toMatchObject({ strand: 'bubble', tree: 'fir', cursor: 'plain' });
  expect(effectiveLook(saved, (id) => id === 'tree:flocked')).toMatchObject({ strand: 'bulbs', tree: 'flocked', cursor: 'plain' });
  expect(effectiveLook(saved, (id) => id === 'cursor:spark')).toMatchObject({ strand: 'bulbs', tree: 'fir', cursor: 'spark' });
  expect(saved).toMatchObject({ strand: 'bubble', tree: 'flocked', cursor: 'spark' });
});
it('the egg worlds reset the strand, the tree and the cursor', () => {
  const mine: Look = { ...STARTER_LOOK, strand: 'c9', tree: 'feather', cursor: 'spark' };
  for (const w of ['secret', 'home-alone'] as const) expect(worldLook(mine, w)).toMatchObject({ strand: 'bulbs', tree: 'fir', cursor: 'plain' });
});
