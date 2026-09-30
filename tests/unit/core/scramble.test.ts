import { describe, expect, it } from 'vitest';
import { D, L, R, U } from '../../../src/core/dirs';
import { generateSolution } from '../../../src/core/generate';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { orientationsOf, randomColors, randomOrientation, scramble } from '../../../src/core/scramble';

describe('orientation classes (original Game.Oi)', () => {
  it('groups shapes by class', () => {
    expect(orientationsOf(U)).toEqual([U, D, L, R]);
    expect(orientationsOf(L | R)).toEqual([U | D, L | R]);
    expect(orientationsOf(D | L)).toEqual([U | L, U | R, L | D, R | D]);
    expect(orientationsOf(U | D | R)).toEqual([U | L | R, U | L | D, U | R | D, L | R | D]);
    expect(orientationsOf(U | D | L | R)).toEqual([U | D | L | R]);
  });
  it('rejects a non-shape', () => {
    expect(() => orientationsOf(0)).toThrow();
  });
});

describe('scramble', () => {
  it('keeps every tile in its own shape class', () => {
    const sol = generateSolution(GRID, mulberry32(7));
    const bits = scramble(GRID, sol, mulberry32(8));
    for (const i of GRID.ids) expect(orientationsOf(sol[i])).toContain(bits[i]);
    for (let i = 0; i < bits.length; i++) if (!GRID.cells[i]) expect(bits[i]).toBe(0);
  });
  it('picks orientations uniformly', () => {
    const rng = mulberry32(3);
    const counts = new Map<number, number>();
    for (let k = 0; k < 8000; k++) {
      const b = randomOrientation(U | R, rng);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([U | L, U | R, L | D, R | D].sort((a, b) => a - b));
    for (const c of counts.values()) expect(Math.abs(c - 2000)).toBeLessThan(200);
  });
});

describe('randomColors (original Block.xi)', () => {
  it('gives every tile a colour index 0..5', () => {
    const colors = randomColors(GRID, mulberry32(5));
    for (const i of GRID.ids) {
      expect(Number.isInteger(colors[i])).toBe(true);
      expect(colors[i]).toBeGreaterThanOrEqual(0);
      expect(colors[i]).toBeLessThan(6);
    }
  });
});
