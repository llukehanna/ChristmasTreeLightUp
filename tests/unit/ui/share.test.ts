import { expect, it } from 'vitest';
import { shareText } from '../../../src/ui/share';

it('writes the share line', () => {
  expect(shareText(84)).toBe('Lit the tree in 1:24 · aglow.lukeghanna.com');
});
