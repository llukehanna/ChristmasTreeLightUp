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
it('gives every scene six bulb colours', () => {
  for (const s of Object.values(SCENES)) expect(s.bulbs).toHaveLength(6);
});
