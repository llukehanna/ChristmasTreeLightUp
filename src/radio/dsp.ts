import type { Rng } from '../core/rng';

/**
 * Brown (random-walk) noise that loops without a step: a linear ramp is subtracted so the last sample equals the
 * first, which makes the wrap-around jump zero instead of a random thump.
 */
export function seamlessBrownNoise(len: number, rng: Rng): Float32Array<ArrayBuffer> {
  const d = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  const drift = d[len - 1] - d[0];
  for (let i = 0; i < len; i++) d[i] -= (drift * i) / (len - 1);
  return d;
}

/**
 * Equal-power gain curve from `from` to `to` (steps + 1 points). A rising fade follows sin and a falling one cos,
 * so a fade-in and a fade-out over the same x satisfy in² + out² = 1 (no mid-fade dip, unlike a linear crossfade).
 */
export function equalPowerCurve(from: number, to: number, steps: number): Float32Array {
  const c = new Float32Array(steps + 1);
  for (let k = 0; k <= steps; k++) {
    const x = (k / steps) * (Math.PI / 2);
    c[k] = to >= from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x);
  }
  return c;
}

/** The crossfade never outlasts the outgoing track: clamp to what is left of it (min 0.25s). */
export function crossfadeLength(remaining: number, max: number, min = 0.25): number {
  if (!Number.isFinite(remaining)) return max;
  return Math.max(min, Math.min(max, remaining - 0.05));
}
