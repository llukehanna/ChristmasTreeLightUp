import { expect, it } from 'vitest';
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
