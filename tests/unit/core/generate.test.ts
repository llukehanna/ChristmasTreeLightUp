import { describe, expect, it } from 'vitest';
import { computeLighting } from '../../../src/core/board';
import { D, DIRS, OPPOSITE } from '../../../src/core/dirs';
import { generateSolution } from '../../../src/core/generate';
import { GRID, neighbor } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';

describe('generateSolution (original Game.Ji)', () => {
  it('always produces a spanning tree over all 97 tiles', () => {
    const violations: string[] = [];
    const MAX_VIOLATIONS = 20; // cap for readability

    for (let seed = 1; seed <= 1000; seed++) {
      const bits = generateSolution(GRID, mulberry32(seed));
      let linkEnds = 0;

      // Check all tiles and links
      for (let i = 0; i < bits.length; i++) {
        if (!GRID.cells[i]) {
          // non-tile index must have bits 0
          if (bits[i] !== 0 && violations.length < MAX_VIOLATIONS) {
            violations.push(`seed ${seed}: non-tile ${i} has bits ${bits[i]}`);
          }
          continue;
        }

        // tile must have bits > 0
        if (bits[i] <= 0 && violations.length < MAX_VIOLATIONS) {
          violations.push(`seed ${seed}: tile ${i} has bits ${bits[i]}`);
        }

        // check all link directions
        for (const d of DIRS) {
          if (!(bits[i] & d)) continue;
          if (i === GRID.root && d === D) continue; // root's down link goes to source

          const j = neighbor(GRID, i, d);
          if (j < 0 && violations.length < MAX_VIOLATIONS) {
            violations.push(`seed ${seed}: tile ${i} link ${d} points to invalid neighbor ${j}`);
            continue;
          }

          // neighbor must have opposite link bit
          if (!(bits[j] & OPPOSITE[d]) && violations.length < MAX_VIOLATIONS) {
            violations.push(`seed ${seed}: tile ${i} link ${d} not reciprocated by tile ${j}`);
          }

          linkEnds++;
        }
      }

      // Check spanning tree property: n-1 edges for 97 nodes
      if (linkEnds / 2 !== 96 && violations.length < MAX_VIOLATIONS) {
        violations.push(`seed ${seed}: linkEnds/2 = ${linkEnds / 2}, expected 96`);
      }

      // Check root down link
      if (!(bits[GRID.root] & D) && violations.length < MAX_VIOLATIONS) {
        violations.push(`seed ${seed}: root ${GRID.root} missing down link`);
      }

      // Check connectivity
      const lighting = computeLighting(GRID, bits);
      if (lighting.count !== 97 && violations.length < MAX_VIOLATIONS) {
        violations.push(`seed ${seed}: lighting.count = ${lighting.count}, expected 97`);
      }
    }

    expect(violations).toEqual([]);
  }, 30_000); // 1000 boards: allow time on slow machines
});
