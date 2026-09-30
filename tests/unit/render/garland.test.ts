import { describe, expect, it } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { garlandGeometry, garlandLitCount } from '../../../src/render/garland';
import { X, Y, computeLayout } from '../../../src/render/layout';

describe('garlandLitCount', () => {
  it('lights bulb k once the lit fraction reaches (k + 1) / n', () => {
    for (const n of [12, 18]) {
      for (let k = 0; k < n; k++) {
        expect(garlandLitCount((k + 1) / n, n)).toBeGreaterThanOrEqual(k + 1);
        expect(garlandLitCount((k + 1) / n - 1e-6, n)).toBe(k);
      }
    }
  });
  it('is empty at 0, full at 1, and follows real tile counts', () => {
    const tiles = GRID.ids.length;
    expect(garlandLitCount(0, 18)).toBe(0);
    expect(garlandLitCount(1, 18)).toBe(18);
    expect(garlandLitCount(tiles / tiles, 12)).toBe(12);
    expect(garlandLitCount(Math.ceil(tiles / 12) / tiles, 12)).toBe(1);
    expect(garlandLitCount((Math.ceil(tiles / 12) - 1) / tiles, 12)).toBe(0);
  });
});

// Chrome bottoms from styles.css: the HUD is 32px tall at top 26px (desktop) or 14px (phone).
const VIEWPORTS: [number, number][] = [
  [390, 844],
  [1440, 900],
  [1024, 768],
  [820, 560],
];

describe('garlandGeometry', () => {
  for (const [w, h] of VIEWPORTS) {
    it(`hangs clear of the chrome, the viewport edges, the star and the tiles at ${w}×${h}`, () => {
      const L = computeLayout(w, h, 1);
      const chrome = w < 600 ? 46 : 58;
      const g = garlandGeometry(w, L.s, chrome);
      expect(g.n).toBe(w < 600 ? 12 : 18);
      expect(g.bulbs).toHaveLength(g.n);
      expect(g.y0).toBeGreaterThan(chrome + 4);
      const starX = X(L, 0);
      const starY = Y(L, -1.3);
      for (const b of g.bulbs) {
        // socket top sits on the wire, below the chrome
        expect(b.y - 0.06 * g.size).toBeGreaterThan(chrome + 4);
        // the whole bulb stays on screen
        expect(b.x - 0.45 * g.size).toBeGreaterThan(0);
        expect(b.x + 0.45 * g.size).toBeLessThan(w);
        // no bulb reaches into the star
        for (let t = 0; t <= 1.4; t += 0.1) {
          const px = b.x - Math.sin(b.angle) * t * g.size;
          const py = b.y + Math.cos(b.angle) * t * g.size;
          expect(Math.hypot(px - starX, py - starY)).toBeGreaterThan(0.8 * L.s + 0.35 * g.size);
        }
      }
      expect(g.bottom).toBeLessThan(Y(L, 0));
    });
  }
  it('is symmetric about the centre', () => {
    const g = garlandGeometry(1440, 60, 58);
    for (let k = 0; k < g.n; k++) expect(g.bulbs[k].x + g.bulbs[g.n - 1 - k].x).toBeCloseTo(1440, 6);
  });
});
