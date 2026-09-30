import { describe, expect, it } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { computeLayout, tileAt, tileCenter } from '../../../src/render/layout';

describe('computeLayout', () => {
  it('is height-limited on a desktop window', () => {
    const L = computeLayout(1440, 900, 2);
    expect(L.s).toBeCloseTo((900 - 74 - 48) / 12.7, 5);
    expect(L.ox).toBe(720);
  });
  it('fills the width on a phone (tiles ≈ 21px)', () => {
    const L = computeLayout(375, 812, 3);
    expect(L.s).toBeCloseTo(375 / 17.6, 5);
    expect(L.s * 17).toBeLessThanOrEqual(375);
  });
});

describe('tile hit-testing', () => {
  const L = computeLayout(1440, 900, 1);
  it('maps every tile centre back to that tile', () => {
    for (const i of GRID.ids) {
      const [x, y] = tileCenter(L, GRID, i);
      expect(tileAt(L, GRID, x, y)).toBe(i);
    }
  });
  it('has no dead zones: points near a tile edge still hit it', () => {
    const i = GRID.root;
    const [x, y] = tileCenter(L, GRID, i);
    expect(tileAt(L, GRID, x + L.s * 0.49, y - L.s * 0.49)).toBe(i);
  });
  it('returns -1 outside the tree', () => {
    expect(tileAt(L, GRID, 5, 5)).toBe(-1);
  });
});
