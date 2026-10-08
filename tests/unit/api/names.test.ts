import { expect, it } from 'vitest';
import { cleanName, isReserved, nameKey } from '../../../src/api/names';

it('cleanName keeps 3–20 letters, digits, spaces, - and _, trimmed, with no double spaces', () => {
  expect(cleanName('  Tinsel Tom ')).toBe('Tinsel Tom');
  expect(cleanName('lat_long-2')).toBe('lat_long-2');
  for (const bad of ['ab', 'x'.repeat(21), 'a  b', 'émile', 'ana!', 'Luke H.', 42, null]) expect(cleanName(bad), String(bad)).toBeNull();
});

it('reserves admin, aglow, santa and friends whatever the case or separators', () => {
  for (const n of ['Admin', 'AGLOW', 'Santa', 's-a n_t a', 'Santa Claus', 'support']) expect(isReserved(n), n).toBe(true);
  for (const n of ['Santa Fan', 'Comet', 'Aglowing']) expect(isReserved(n), n).toBe(false);
  expect(nameKey('Comet')).toBe('comet');
});
