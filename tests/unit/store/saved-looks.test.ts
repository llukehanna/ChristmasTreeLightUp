// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { NO_DECOR, STARTER_LOOK, type Look } from '../../../src/store/look';
import { loadLooks, saveLookIn } from '../../../src/store/saved-looks';

beforeEach(() => localStorage.clear());

const COSY: Look = { ...STARTER_LOOK, scene: 'parlour', path: 'fairy', topper: 'angel', decor: { ...NO_DECOR, skirt: true }, presents: 'luxe' };

it('three empty slots on a fresh device', () => {
  expect(loadLooks()).toEqual([null, null, null]);
});

it('a saved look comes back whole in its slot, under aglow.looks', () => {
  saveLookIn(1, { name: 'Cosy', look: COSY });
  expect(loadLooks()).toEqual([null, { name: 'Cosy', look: COSY }, null]);
  saveLookIn(0, { name: 'Plain', look: STARTER_LOOK });
  expect(loadLooks()).toEqual([{ name: 'Plain', look: STARTER_LOOK }, { name: 'Cosy', look: COSY }, null]);
  expect(JSON.parse(localStorage.getItem('aglow.looks')!)).toHaveLength(3);
});

it('names are trimmed to 16 characters; a blank one is "Look n"', () => {
  saveLookIn(0, { name: '   The whole Christmas parlour   ', look: COSY });
  saveLookIn(2, { name: '   ', look: COSY });
  const looks = loadLooks();
  expect(looks[0]?.name).toBe('The whole Christ');
  expect(looks[2]?.name).toBe('Look 3');
});

it('each look is read through parseLook, and anything unreadable is an empty slot', () => {
  localStorage.setItem('aglow.looks', JSON.stringify([{ name: 'Odd', look: { scene: 'moon', path: 'neon' } }, 'junk', { look: COSY }, { name: 'Extra', look: COSY }]));
  expect(loadLooks()).toEqual([{ name: 'Odd', look: { ...STARTER_LOOK, path: 'neon' } }, null, null]);
  localStorage.setItem('aglow.looks', '{"not":"a list"}');
  expect(loadLooks()).toEqual([null, null, null]);
});
