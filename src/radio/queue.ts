import type { Rng } from '../core/rng';

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const nextIndex = (i: number, n: number): number => (i + 1) % n;
/** Previous restarts the current track if it has played for more than 3 seconds. */
export const prevIndex = (i: number, n: number, positionSec: number): number => (positionSec > 3 ? i : (i - 1 + n) % n);
