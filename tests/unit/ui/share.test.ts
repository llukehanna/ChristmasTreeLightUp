import { expect, it } from 'vitest';
import { coverRect, shareText } from '../../../src/ui/share';

it('writes the share line', () => {
  expect(shareText(84)).toBe('Lit the tree in 1:24 · aglow.lukeghanna.com');
});

it('crops the stage to a centred 4:5 cover rectangle without stretching', () => {
  expect(coverRect(1920, 1080, 0.8)).toEqual({ x: 528, y: 0, w: 864, h: 1080 });
  expect(coverRect(400, 1000, 0.8)).toEqual({ x: 0, y: 250, w: 400, h: 500 });
  const r = coverRect(1170, 2532, 0.8);
  expect(r.w / r.h).toBeCloseTo(0.8, 9);
});
