import { expect, it } from 'vitest';
import { ITEMS } from '../../../src/core/catalogue';
import { GILDED, PALETTES, withPalette } from '../../../src/render/palettes';
import { AURORA, HOME_ALONE, SCENES } from '../../../src/render/scenes';

it('the scene palette and the egg worlds are left alone', () => {
  expect(withPalette(SCENES.fireside, 'scene')).toBe(SCENES.fireside);
  expect(withPalette(AURORA, 'gilded')).toBe(AURORA);
  expect(withPalette(HOME_ALONE, 'classic')).toBe(HOME_ALONE);
});
it('Gilded turns the bulbs and the lit wire gold', () => {
  expect(withPalette(SCENES.midnight, 'gilded')).toMatchObject({ bulbs: PALETTES.gilded, ...GILDED, id: 'midnight', sky: SCENES.midnight.sky });
});
it('other palettes change only the bulbs', () => {
  const sc = withPalette(SCENES.fireside, 'ice');
  expect(sc.bulbs).toBe(PALETTES.ice);
  expect(sc.glow).toBe(SCENES.fireside.glow);
});
it('every palette has six bulbs, and the same pair gives the same object', () => {
  for (const b of Object.values(PALETTES)) expect(b).toHaveLength(6);
  expect(withPalette(SCENES.frost, 'pastel')).toBe(withPalette(SCENES.frost, 'pastel'));
});
it('every bulb palette the catalogue names has six #rrggbb colours', () => {
  const named = ITEMS.filter((i) => i.slot === 'palette').map((i) => i.value);
  expect(named).toEqual(expect.arrayContaining(['golden', 'candy', 'emerald', 'disco', 'peppermint', 'snow', 'rosegold', 'copper', 'sapphire']));
  for (const id of named) {
    const p = PALETTES[id as keyof typeof PALETTES];
    expect(p, id).toHaveLength(6);
    for (const c of p) expect(c, id).toMatch(/^#[0-9a-f]{6}$/);
  }
});
it("Golden is the lab's", () => {
  expect(PALETTES.golden).toEqual(['#ffc83a', '#ffd95e', '#ffb526', '#ffe27a', '#ffa91c', '#ffcf48']);
});
