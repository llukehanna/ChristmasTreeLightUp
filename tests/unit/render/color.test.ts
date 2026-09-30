import { expect, it } from 'vitest';
import { hexRgb, mix, rgba, shade } from '../../../src/render/color';

it('converts and blends hex colours', () => {
  expect(hexRgb('#ff8000')).toEqual([255, 128, 0]);
  expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  expect(shade('#ff8000', 0.5)).toBe('rgb(128,64,0)');
  expect(rgba('#ff8000', 0.25)).toBe('rgba(255,128,0,0.25)');
});
