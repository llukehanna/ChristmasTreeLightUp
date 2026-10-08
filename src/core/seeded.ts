import { Board } from './board';
import { GRID } from './mask';
import { mulberry32 } from './rng';

/**
 * Bump when anything that turns a seed into a tree changes: Board.random's call order (solution, scramble, colors),
 * the mask, a generator or the PRNG. Keep every version stored games still use in GENERATORS (as a frozen copy of the
 * old code if need be), so their logs always replay.
 */
export const GEN_VERSION = 1;

const GENERATORS: Readonly<Record<number, (seed: number, headless: boolean) => Board>> = {
  1: (seed, headless) => Board.random(GRID, mulberry32(seed), headless),
};

export const isSeed = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

/** The tree a server seed makes, or null for an unknown generator version or a value that is not a uint32. */
export function seededBoard(seed: number, genVersion: number, headless = false): Board | null {
  const make = Object.hasOwn(GENERATORS, genVersion) ? GENERATORS[genVersion] : undefined;
  return make && isSeed(seed) ? make(seed, headless) : null;
}
