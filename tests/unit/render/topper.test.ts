import { describe, expect, it } from 'vitest';
import { starCenter } from '../../../src/render/effects';
import { computeLayout, tileAt } from '../../../src/render/layout';
import { GRID } from '../../../src/core/mask';
import { FADE_MS, FLIP_MS, SWAY_DEG, WOBBLE_MS, crossfade, flipPose, headLight, idleSway, onStar, tapStrength, wobble } from '../../../src/render/topper';

describe('the coin flip', () => {
  it('spins about the vertical axis: full width at both ends, edge-on at the midpoint, the face swapping there', () => {
    expect(flipPose(-1)).toBeNull();
    expect(flipPose(FLIP_MS)).toBeNull();
    const start = flipPose(0)!;
    expect(start.scaleX).toBeCloseTo(1, 6);
    expect(start.newFace).toBe(false);
    const mid = flipPose(FLIP_MS / 2)!;
    expect(mid.scaleX).toBeCloseTo(0, 6);
    expect(mid.newFace).toBe(true);
    expect(mid.edge).toBeCloseTo(1, 6);
    expect(flipPose(FLIP_MS / 2 - 5)!.newFace).toBe(false);
    expect(flipPose(FLIP_MS - 1)!.scaleX).toBeGreaterThan(0.999);
  });

  it('eases: slow off the mark, fastest through the middle', () => {
    const at = (t: number) => flipPose(t)!.scaleX;
    const early = 1 - at(FLIP_MS * 0.1);
    const middle = at(FLIP_MS * 0.4) - at(FLIP_MS * 0.5);
    expect(middle).toBeGreaterThan(early * 3);
  });

  it('rises and grows a little toward the viewer, landing back where it started', () => {
    expect(flipPose(0)!.toss).toBeCloseTo(0, 6);
    expect(flipPose(FLIP_MS / 2)!.toss).toBeCloseTo(1, 6);
    expect(flipPose(FLIP_MS - 1)!.toss).toBeLessThan(0.01);
  });

  it('under reduced motion: a 300 ms crossfade instead', () => {
    expect(crossfade(-1)).toBeNull();
    expect(crossfade(0)).toBe(0);
    expect(crossfade(FADE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(crossfade(FADE_MS)).toBeNull();
  });
});

describe('the tap wobble', () => {
  it('springs for about 250 ms, then rests exactly', () => {
    expect(wobble(-1, 1)).toEqual({ angle: 0, scale: 1 });
    expect(wobble(WOBBLE_MS, 1)).toEqual({ angle: 0, scale: 1 });
    expect(Math.abs(wobble(WOBBLE_MS * 0.15, 1).angle)).toBeGreaterThan(0.05);
    expect(Math.abs(wobble(WOBBLE_MS - 1, 1).angle)).toBeLessThan(0.001);
  });

  it('swings both ways, and harder with each tap toward the fifth', () => {
    const angles = Array.from({ length: 50 }, (_, k) => wobble((k / 50) * WOBBLE_MS, 1).angle);
    expect(Math.max(...angles)).toBeGreaterThan(0);
    expect(Math.min(...angles)).toBeLessThan(0);
    for (let n = 2; n <= 4; n++) expect(tapStrength(n)).toBeGreaterThan(tapStrength(n - 1));
    const peak = (n: number) => Math.max(...Array.from({ length: 50 }, (_, k) => Math.abs(wobble((k / 50) * WOBBLE_MS, tapStrength(n)).angle)));
    expect(peak(4)).toBeGreaterThan(peak(1));
    expect(peak(4)).toBeLessThan((14 * Math.PI) / 180); // small: a nudge, not a spin
  });
});

describe('the head', () => {
  it('stays dim before the win, brightening a little as the tree lights; ignites fully with the win', () => {
    const dark = headLight({ glow: 0, on: 0 }, false, 0, 0);
    const half = headLight({ glow: 0, on: 0 }, false, 0.5, 0);
    const nearly = headLight({ glow: 0, on: 0 }, false, 0.98, 0);
    expect(dark).toBe(0);
    expect(half).toBeGreaterThan(0);
    expect(nearly).toBeGreaterThan(half);
    expect(nearly).toBeLessThanOrEqual(0.35);
    expect(headLight({ glow: 1, on: 0.5 }, true, 1, 0)).toBe(0.5);
    expect(headLight({ glow: 1, on: 1 }, true, 1, 0)).toBe(1);
    // A tap or a flip lights it briefly, never past full.
    expect(headLight({ glow: 0, on: 0 }, false, 0, 1)).toBeGreaterThan(0.3);
    expect(headLight({ glow: 1, on: 1 }, true, 1, 1)).toBe(1);
  });

  it('sways ±4° and bobs ±2% of its height after the win, easing in; still before it and under reduced motion', () => {
    expect(idleSway(5000, null, false)).toEqual({ angle: 0, bob: 0 });
    expect(idleSway(5000, 0, true)).toEqual({ angle: 0, bob: 0 });
    expect(idleSway(500, 0, false)).toEqual({ angle: 0, bob: 0 }); // still igniting
    let maxA = 0;
    let maxB = 0;
    for (let t = 0; t < 20_000; t += 37) {
      const { angle, bob } = idleSway(t, 0, false);
      maxA = Math.max(maxA, Math.abs(angle));
      maxB = Math.max(maxB, Math.abs(bob));
    }
    expect(maxA).toBeLessThanOrEqual((SWAY_DEG * Math.PI) / 180 + 1e-9);
    expect(maxA).toBeGreaterThan((SWAY_DEG * Math.PI) / 180 * 0.95);
    expect(maxB).toBeLessThanOrEqual(0.02 + 1e-9);
    expect(maxB).toBeGreaterThan(0.019);
    // Slow: a quarter-second apart it has barely moved.
    expect(Math.abs(idleSway(9000, 0, false).angle - idleSway(9250, 0, false).angle)).toBeLessThan(0.02);
  });
});

describe('the star hit area', () => {
  const L = computeLayout(1280, 800, 2);
  const [cx, cy] = starCenter(L);

  it('a circle of 0.9 tiles around the star centre', () => {
    expect(onStar(L, cx, cy)).toBe(true);
    expect(onStar(L, cx + 0.89 * L.s, cy)).toBe(true);
    expect(onStar(L, cx, cy - 0.89 * L.s)).toBe(true);
    expect(onStar(L, cx + 0.95 * L.s, cy)).toBe(false);
    expect(onStar(L, cx, cy + 0.95 * L.s)).toBe(false);
  });

  it('never overlaps a tile: anything on the star is not on the board', () => {
    for (let a = 0; a < 360; a += 15) {
      const r = 0.9 * L.s;
      const x = cx + Math.cos((a * Math.PI) / 180) * r;
      const y = cy + Math.sin((a * Math.PI) / 180) * r;
      expect(tileAt(L, GRID, x, y)).toBe(-1);
    }
  });
});
