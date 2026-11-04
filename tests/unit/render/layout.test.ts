import { describe, expect, it } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { computeLayout, foliageHalfWidth, tileAt, tileCenter, treeRightEdge } from '../../../src/render/layout';

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

describe('treeRightEdge', () => {
  it('covers every tile of the mask, row by row', () => {
    for (let r = 0; r < GRID.h; r++) {
      let right = -1;
      for (let c = 0; c < GRID.w; c++) if (GRID.cells[r * GRID.w + c]) right = c + 1;
      if (right < 0) continue;
      const half = right - GRID.w / 2;
      // Any band whose bottom lies in this row (v in [r, r + 1)) must reach this row's tiles.
      for (const v of [r, r + 0.5, r + 0.99]) expect(foliageHalfWidth(v)).toBeGreaterThanOrEqual(half - 1e-9);
    }
  });
  it('is the centre column plus the foliage half-width at the band bottom, in CSS px', () => {
    const L = computeLayout(1440, 900, 1);
    const v = (500 - L.oy) / L.s;
    expect(treeRightEdge(L, 500)).toBeCloseTo(L.ox + foliageHalfWidth(v) * L.s, 6);
  });
  it('widens with the band and stops at the full width', () => {
    const L = computeLayout(1440, 900, 1);
    expect(treeRightEdge(L, 500)).toBeLessThan(treeRightEdge(L, 700));
    expect(treeRightEdge(L, 880)).toBeCloseTo(L.ox + 9.3 * L.s, 6);
  });
});
