// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { floorToys, homeWindow, paintHomeAlone } from '../../../src/render/home-alone-room';
import { X, Y, computeLayout, type Layout } from '../../../src/render/layout';
import { giftBounds, placePresents } from '../../../src/render/presents';

const SIZES = [[1280, 800], [1920, 1080], [390, 844], [320, 568], [844, 390]] as const;
const tiles = (L: Layout) =>
  GRID.ids.map((i) => {
    const x0 = X(L, (i % GRID.w) - GRID.w / 2);
    const y0 = Y(L, Math.floor(i / GRID.w));
    return { x0, y0, x1: x0 + L.s, y1: y0 + L.s };
  });

/** A context that counts calls by name. */
function counter(names: string[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', canvas: { width: 2560, height: 1600 } };
  return new Proxy(state, {
    get: (t, k) => (k in t ? t[k] : (..._: unknown[]) => (names.push(String(k)), String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
    set: (t, k, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

describe('the window', () => {
  for (const [w, h] of SIZES) {
    it(`stands centred behind the tree's upper half, on screen and above the floor, at ${w}×${h}`, () => {
      const L = computeLayout(w, h, 2);
      const win = homeWindow(L);
      expect(win.x).toBeGreaterThanOrEqual(0);
      expect(win.x + win.w).toBeLessThanOrEqual(w);
      expect(win.y).toBeGreaterThanOrEqual(0);
      expect(win.y + win.h).toBeLessThan(Y(L, 10.05));
      expect(win.x + win.w / 2).toBeCloseTo(L.ox, 6);
      expect(win.h).toBeGreaterThan(3 * L.s);
      expect(win.cols).toBeGreaterThanOrEqual(2);
      expect(win.rows).toBeGreaterThanOrEqual(2);
    });
  }
});

describe('the floor toys', () => {
  for (const [w, h] of SIZES) {
    it(`lie on the floor, on screen, clear of every tile, at ${w}×${h}`, () => {
      const L = computeLayout(w, h, 2);
      const rects = tiles(L);
      for (const t of floorToys(L, GRID)) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(w);
        expect(t.y).toBeGreaterThanOrEqual(Y(L, 10.05));
        expect(t.y + t.h).toBeLessThanOrEqual(h);
        for (const r of rects) expect(t.x + t.w <= r.x0 || r.x1 <= t.x || t.y + t.h <= r.y0 || r.y1 <= t.y).toBe(true);
      }
    });
  }

  for (const [w, h] of SIZES) {
    it(`no toy hides behind a present at ${w}×${h}: each one, turned as drawn, clear of every gift`, () => {
      const L = computeLayout(w, h, 2);
      const gifts = placePresents(L, GRID).map(giftBounds);
      if (w === 1280) expect(gifts.length).toBeGreaterThan(0);
      for (const t of floorToys(L, GRID)) {
        // The toy's box rotated about its centre, as paintToy draws it.
        const ex = (Math.abs(Math.cos(t.rot)) * t.w + Math.abs(Math.sin(t.rot)) * t.h) / 2;
        const ey = (Math.abs(Math.sin(t.rot)) * t.w + Math.abs(Math.cos(t.rot)) * t.h) / 2;
        const [cx, cy] = [t.x + t.w / 2, t.y + t.h / 2];
        for (const g of gifts) expect(cx + ex <= g.x0 || g.x1 <= cx - ex || cy + ey <= g.y0 || g.y1 <= cy - ey, `${t.kind} at ${cx},${cy}`).toBe(true);
      }
    });
  }

  it('a desktop floor has three toy cars and some broken-ornament glints, the same every time', () => {
    const L = computeLayout(1280, 800, 2);
    const toys = floorToys(L, GRID);
    expect(toys.filter((t) => t.kind === 'car')).toHaveLength(3);
    expect(toys.filter((t) => t.kind === 'shard').length).toBeGreaterThanOrEqual(3);
    expect(floorToys(L, GRID)).toEqual(toys);
  });
});

it('the room paints once with its window panes divided, deterministically', () => {
  const L = computeLayout(1280, 800, 2);
  const a: string[] = [];
  const b: string[] = [];
  paintHomeAlone(counter(a), L, mulberry32(3), Y(L, 10.05));
  paintHomeAlone(counter(b), L, mulberry32(3), Y(L, 10.05));
  expect(a).toEqual(b);
  const win = homeWindow(L);
  expect(a.filter((n) => n === 'fillRect').length).toBeGreaterThan(win.cols - 1 + win.rows - 1);
});
