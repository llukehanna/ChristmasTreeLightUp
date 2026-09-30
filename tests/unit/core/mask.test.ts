import { describe, expect, it } from 'vitest';
import { D, L, R, U } from '../../../src/core/dirs';
import { GRID, dirBetween, neighbor } from '../../../src/core/mask';

describe('GRID (original tree mask)', () => {
  it('is 17 wide and 10 tall with 97 tiles', () => {
    expect(GRID.w).toBe(17);
    expect(GRID.h).toBe(10);
    expect(GRID.ids.length).toBe(97);
  });
  it('has rows of 3,5,7,9,11,13,15,17,17 tiles', () => {
    const rows = Array.from({ length: 9 }, (_, y) => GRID.cells.slice(y * 17, y * 17 + 17).filter(Boolean).length);
    expect(rows).toEqual([3, 5, 7, 9, 11, 13, 15, 17, 17]);
  });
  it('puts the source at (8,9) and the root tile directly above it', () => {
    expect([GRID.sourceX, GRID.sourceY]).toEqual([8, 9]);
    expect(GRID.root).toBe(8 * 17 + 8);
    expect(GRID.cells[GRID.root]).toBe(true);
  });
});

describe('neighbor / dirBetween', () => {
  it('returns -1 off the tree and the index on it', () => {
    expect(neighbor(GRID, GRID.root, D)).toBe(-1);
    expect(neighbor(GRID, GRID.root, U)).toBe(GRID.root - 17);
    expect(neighbor(GRID, 7, L)).toBe(-1);
  });
  it('finds the direction between adjacent tiles', () => {
    expect(dirBetween(GRID, GRID.root, GRID.root - 17)).toBe(U);
    expect(dirBetween(GRID, GRID.root, GRID.root + 1)).toBe(R);
    expect(dirBetween(GRID, GRID.root, GRID.root - 1)).toBe(L);
  });
});
