import { expect, it } from 'vitest';
import { chimeSemitone, starTapSemitone } from '../../../src/audio/sfx';

it('climbs a major pentatonic scale, octave by octave', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(chimeSemitone)).toEqual([0, 2, 4, 7, 9, 12, 14]);
});

it("the star's tap ticks rise a pentatonic step each tap, high above the wave's chimes", () => {
  const ticks = [0, 1, 2, 3].map(starTapSemitone);
  for (let k = 1; k < 4; k++) expect(ticks[k]).toBeGreaterThan(ticks[k - 1]);
  expect(ticks[0]).toBeGreaterThanOrEqual(12);
  expect(ticks[3] % 12).toBe(0); // the fourth lands on G, ready for the jingle
});
