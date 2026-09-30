import { expect, it } from 'vitest';
import { SCENES, sceneForHour } from '../../../src/render/scenes';

it('picks the scene by local hour', () => {
  expect(sceneForHour(7)).toBe('frost');
  expect(sceneForHour(15)).toBe('frost');
  expect(sceneForHour(16)).toBe('fireside');
  expect(sceneForHour(19)).toBe('fireside');
  expect(sceneForHour(20)).toBe('midnight');
  expect(sceneForHour(3)).toBe('midnight');
});
it('lifts unlit wires on Frost per path style, and leaves the night scenes plain', () => {
  expect(SCENES.frost.unlit.filament.look).toBe('twotone');
  expect(SCENES.frost.unlit.fairy.look).toBe('glint');
  expect(SCENES.frost.unlit.neon.look).toBe('glint');
  for (const id of ['midnight', 'fireside'] as const)
    for (const u of Object.values(SCENES[id].unlit)) expect(u.look).toBe('plain');
});
it('gives every scene six bulb colours', () => {
  for (const s of Object.values(SCENES)) expect(s.bulbs).toHaveLength(6);
});
