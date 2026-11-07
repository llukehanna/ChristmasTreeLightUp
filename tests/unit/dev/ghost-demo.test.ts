import { describe, expect, it } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { demoGhostTrack } from '../../../src/dev/ghost-demo';

// DEV ONLY (C4 task 6): goes with src/dev/ghost-demo.ts when Luke has picked.
describe('demoGhostTrack', () => {
  it('solves the tree in play in about 45 s, lighting it up bit by bit, and leaves the board alone', () => {
    for (const seed of [1, 2, 3]) {
      const board = seededBoard(seed, GEN_VERSION);
      if (!board) throw new Error('no board');
      const bits = [...board.bits];
      const track = demoGhostTrack(board);
      expect(track).not.toBeNull();
      expect(board.bits).toEqual(bits);
      expect(board.rotating.size).toBe(0);
      expect(track?.ms).toBeGreaterThan(40_000);
      expect(track?.ms).toBeLessThan(50_000);
      expect(track?.litAt(track.ms)).toBe(GRID.ids.length);
      // Roughly steady: about a third lit by a third of the way.
      const third = track?.litAt((track?.ms ?? 0) / 3) ?? 0;
      expect(third).toBeGreaterThan(GRID.ids.length * 0.1);
      expect(third).toBeLessThan(GRID.ids.length * 0.7);
    }
  });
});
