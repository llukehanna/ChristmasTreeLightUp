import { expect, it } from 'vitest';
import { chimeSemitone } from '../../../src/audio/sfx';

it('climbs a major pentatonic scale, octave by octave', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(chimeSemitone)).toEqual([0, 2, 4, 7, 9, 12, 14]);
});
