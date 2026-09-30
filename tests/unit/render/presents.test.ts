import { describe, expect, it } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { computeLayout, tileAt, Y } from '../../../src/render/layout';
import { giftBounds, placePresents, tileRects } from '../../../src/render/presents';

const VIEWPORTS: [number, number][] = [
  [390, 844],
  [1440, 900],
  [1024, 768],
  [820, 560],
];

describe('placePresents', () => {
  for (const [w, h] of VIEWPORTS) {
    it(`places every gift clear of the tiles and inside the viewport at ${w}×${h}`, () => {
      const L = computeLayout(w, h, 2);
      const gifts = placePresents(L, GRID);
      expect(gifts.length).toBe(w < 600 ? 5 : 6);
      const tiles = tileRects(L, GRID);
      for (const g of gifts) {
        const b = giftBounds(g);
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.y0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(w);
        expect(b.y1).toBeLessThanOrEqual(h);
        for (const t of tiles) {
          const hit = b.x0 < t.x1 && t.x0 < b.x1 && b.y0 < t.y1 && t.y0 < b.y1;
          expect(hit).toBe(false);
        }
        // hit-testing anywhere on a gift finds no tile
        for (let fx = 0; fx <= 1; fx += 0.125) {
          for (let fy = 0; fy <= 1; fy += 0.125) {
            expect(tileAt(L, GRID, b.x0 + (b.x1 - b.x0) * fx, b.y0 + (b.y1 - b.y0) * fy)).toBe(-1);
          }
        }
      }
    });
  }

  it('puts gifts in front of the tree below the ground line on phones', () => {
    const L = computeLayout(390, 844, 3);
    for (const g of placePresents(L, GRID)) expect(g.base).toBeGreaterThan(Y(L, 10.05));
  });

  it('flanks the tree base on desktop, left and right', () => {
    const L = computeLayout(1440, 900, 2);
    const gifts = placePresents(L, GRID);
    expect(gifts.some((g) => g.cx < L.ox - 5 * L.s)).toBe(true);
    expect(gifts.some((g) => g.cx > L.ox + 5 * L.s)).toBe(true);
    expect(gifts.every((g) => Math.abs(g.cx - L.ox) > 5 * L.s)).toBe(true);
  });

  it('places the full set on common phone and desktop sizes', () => {
    const sizes = [[360, 640], [375, 667], [414, 896], [430, 932], [600, 900], [768, 1024], [1280, 720], [1366, 768], [1920, 1080], [2560, 1440], [1200, 600]];
    for (const [w, h] of sizes) expect([w, h, placePresents(computeLayout(w, h, 1), GRID).length]).toEqual([w, h, w < 600 ? 5 : 6]);
  });

  it('never overlaps a tile across a sweep of window sizes', () => {
    const bad: string[] = [];
    for (let w = 320; w <= 2560; w += 97) {
      for (let h = 480; h <= 1600; h += 113) {
        const L = computeLayout(w, h, 1);
        const tiles = tileRects(L, GRID);
        for (const g of placePresents(L, GRID)) {
          const b = giftBounds(g);
          const off = !(b.x0 >= 0 && b.x1 <= w && b.y0 >= 0 && b.y1 <= h);
          const hit = tiles.some((t) => b.x0 < t.x1 && t.x0 < b.x1 && b.y0 < t.y1 && t.y0 < b.y1);
          if (off || hit) bad.push(`${w}×${h}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
