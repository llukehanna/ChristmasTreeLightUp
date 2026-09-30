import { describe, expect, it } from 'vitest';
import { computeLighting } from '../../../src/core/board';
import { D, DIRS, OPPOSITE } from '../../../src/core/dirs';
import { generateSolution } from '../../../src/core/generate';
import { GRID, neighbor } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';

describe('generateSolution (original Game.Ji)', () => {
  it('always produces a spanning tree over all 97 tiles', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const bits = generateSolution(GRID, mulberry32(seed));
      let linkEnds = 0;
      for (let i = 0; i < bits.length; i++) {
        if (!GRID.cells[i]) {
          expect(bits[i]).toBe(0);
          continue;
        }
        expect(bits[i]).toBeGreaterThan(0);
        for (const d of DIRS) {
          if (!(bits[i] & d)) continue;
          if (i === GRID.root && d === D) continue; // the root's down link goes to the source
          const j = neighbor(GRID, i, d);
          expect(j).toBeGreaterThanOrEqual(0);
          expect(bits[j] & OPPOSITE[d]).toBeTruthy();
          linkEnds++;
        }
      }
      expect(linkEnds / 2).toBe(96); // n - 1 links: a tree
      expect(bits[GRID.root] & D).toBeTruthy();
      expect(computeLighting(GRID, bits).count).toBe(97); // connected
    }
  }, 30_000); // 1000 boards: allow time on slow machines
});
