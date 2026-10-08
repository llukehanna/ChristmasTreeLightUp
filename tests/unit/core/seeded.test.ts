import { describe, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { GEN_VERSION, isSeed, seededBoard } from '../../../src/core/seeded';

/** FNV-1a of a board's solution, bits and colors: a fingerprint of what a seed generates. */
function fingerprint(b: Board): string {
  const s = JSON.stringify([b.solution, b.bits, b.colors]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('seeded boards', () => {
  it('version 1 is Board.random(GRID, mulberry32(seed)): solution, then scramble, then colors', () => {
    for (const seed of [1, 42, 0xffffffff]) {
      const a = seededBoard(seed, 1);
      const b = Board.random(GRID, mulberry32(seed));
      expect(a?.solution).toEqual(b.solution);
      expect(a?.bits).toEqual(b.bits);
      expect(a?.colors).toEqual(b.colors);
    }
  });

  it('is pinned: a fingerprint changes only with a GEN_VERSION bump (and the old generator stays for stored games)', () => {
    expect(GEN_VERSION).toBe(1);
    expect(fingerprint(seededBoard(1, 1) as Board)).toBe('dc4eccce');
    expect(fingerprint(seededBoard(42, 1) as Board)).toBe('515b3974');
    expect(fingerprint(seededBoard(0xffffffff, 1) as Board)).toBe('b60cd6a2');
  });

  it('is deterministic per seed, and different seeds give different trees', () => {
    expect(seededBoard(7, 1)?.bits).toEqual(seededBoard(7, 1)?.bits);
    expect(seededBoard(7, 1)?.solution).not.toEqual(seededBoard(8, 1)?.solution);
  });

  it('knows no other versions and refuses anything that is not a uint32 seed', () => {
    for (const v of [0, 2, 99, Number.NaN]) expect(seededBoard(1, v)).toBeNull();
    for (const s of [-1, 1.5, 2 ** 32, Number.NaN]) expect(seededBoard(s, 1)).toBeNull();
    expect(isSeed(0)).toBe(true);
    expect(isSeed(0xffffffff)).toBe(true);
    expect(isSeed('1')).toBe(false);
  });

  it('makes a headless board on request', () => {
    expect(seededBoard(5, 1, true)?.headless).toBe(true);
    expect(seededBoard(5, 1)?.headless).toBe(false);
  });
});
