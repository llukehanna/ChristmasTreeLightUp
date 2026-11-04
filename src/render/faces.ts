import { degree } from '../core/dirs';
import type { GarlandGeometry } from './garland';

// The sizes and the gift pick live with the main-chunk code that uses them (bulbs, garland, presents): this module is an
// egg, loaded on first use (src/eggs/load.ts).
export { FACE_ORNAMENT_H } from './bulbs';
export { FACE_GARLAND_H } from './garland';
export { faceGiftIndex } from './presents';

/**
 * Where Luke's face hides in secret mode (spec 2026-10-08 secret mode §3): one tree bulb, one present, one garland
 * bulb, each picked deterministically.
 */

/** The confetti's mini heads come from one cached size: the largest fleck (4.2 CSS px × HEAD_FLECK) at the largest zoom (1.7), rounded up. */
export const FACE_CONFETTI_PX = 29;

/** FNV-1a 32-bit over the low four bits of each tile of the solution: every tree, seeded, local or resumed, hashes the same. */
export function solutionHash(solution: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of solution) h = Math.imul(h ^ (v & 15), 0x01000193) >>> 0;
  return h;
}

/** The face ornament: one of the tree's bulbs (degree-1 tiles of the solution, in `ids` order), picked by the hash; -1 with none. */
export function faceBulbTile(solution: readonly number[], ids: readonly number[]): number {
  const bulbs = ids.filter((i) => degree(solution[i]) === 1);
  return bulbs.length ? bulbs[solutionHash(solution) % bulbs.length] : -1;
}

/** The garland's face: the right swag's bulb nearest that swag's middle (its low point, clear of the star); the first on a tie. */
export function faceGarlandIndex(geo: Pick<GarlandGeometry, 'bulbs' | 'swags'>): number {
  const [a, b] = geo.swags[1];
  const mid = (a + b) / 2;
  let best = -1;
  let d = Number.POSITIVE_INFINITY;
  geo.bulbs.forEach((bulb, k) => {
    if (bulb.x >= a && Math.abs(bulb.x - mid) < d) {
      d = Math.abs(bulb.x - mid);
      best = k;
    }
  });
  return best;
}
