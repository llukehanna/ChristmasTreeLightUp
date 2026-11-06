// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID } from '../../../src/core/mask';
import type { FaceSprites } from '../../../src/render/face-sprites';
import { computeLayout, tileAt, Y } from '../../../src/render/layout';
import { paintSetGift } from '../../../src/render/present-sets';
import { FACE_PAPER, giftBounds, placePresents, Presents, tileRects } from '../../../src/render/presents';
import { SCENES } from '../../../src/render/scenes';

// The real set painter, with its calls noted (a test may silence it to see what the game's own box draws).
vi.mock('../../../src/render/present-sets', async (actual) => {
  const real = await actual<typeof import('../../../src/render/present-sets')>();
  return { ...real, paintSetGift: vi.fn(real.paintSetGift) };
});

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

/** A 2D context that accepts everything and counts each call by name. */
function sink(counts: Map<string, number>): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {
        counts.set(String(k), (counts.get(String(k)) ?? 0) + 1);
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('present sets', () => {
  const L = computeLayout(1440, 900, 2);
  const counts = new Map<string, number>();
  const paintSet = vi.mocked(paintSetGift);
  const real = paintSet.getMockImplementation()!;
  /** The game's box is the only painter of bows by bezier curve here: with the set painter silenced, a curve is its mark. */
  const curves = (): number => counts.get('bezierCurveTo') ?? 0;

  beforeEach(() => {
    counts.clear();
    paintSet.mockClear();
    paintSet.mockImplementation(real);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => sink(counts)) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('none lays out no gifts', () => {
    const p = new Presents();
    p.layout(L, GRID, SCENES.midnight, null, 'none');
    expect(p.gifts).toEqual([]);
    expect(p.bounds()).toBeNull();
    expect(p.faceIndex).toBe(-1);
    counts.clear();
    p.draw(sink(counts), 1);
    expect([...counts]).toEqual([]);
    expect(paintSet).not.toHaveBeenCalled();
  });

  it('none leaves nothing to crash on in secret mode', () => {
    const faces = { ready: true, get: () => null } as unknown as FaceSprites;
    const p = new Presents();
    p.layout(L, GRID, SCENES.midnight, faces, 'none');
    expect(p.faceIndex).toBe(-1);
  });

  it('laying out again after none brings the gifts back', () => {
    const p = new Presents();
    p.layout(L, GRID, SCENES.midnight, null, 'none');
    p.layout(L, GRID, SCENES.midnight, null, 'game');
    expect(p.gifts.length).toBe(6);
    expect(p.bounds()).not.toBeNull();
  });

  for (const set of ['luxe', 'kraft'] as const) {
    it(`${set} paints each box with its own spec, in order`, () => {
      paintSet.mockImplementation(() => {}); // silence it: any curve left is the game's box
      const p = new Presents();
      p.layout(L, GRID, SCENES.midnight, null, set);
      const n = p.gifts.length;
      expect(n).toBe(6);
      // Two passes (base, light) per gift, gift 0..n-1 in order; the box is painted by the set alone.
      expect(paintSet.mock.calls.map((a) => [a[4], a[3], a[5]])).toEqual(
        Array.from({ length: n }, (_, i) => [[i, 'base', set], [i, 'light', set]]).flat(),
      );
      for (const a of paintSet.mock.calls) expect(a[1]).toBe(p.gifts[a[4]]);
      expect(curves()).toBe(0);
    });

    it(`${set} paints something on every one of its six specs, in every light`, () => {
      for (const sc of [SCENES.midnight, SCENES.fireside, SCENES.frost]) {
        counts.clear();
        new Presents().layout(L, GRID, sc, null, set);
        expect(counts.get('fill') ?? 0).toBeGreaterThan(6 * 2 * 10);
      }
    });
  }

  it('a pile of n keeps the first n gifts where they stand', () => {
    const full = new Presents();
    full.layout(L, GRID, SCENES.midnight, null, 'game');
    expect(full.gifts.length).toBe(6);
    for (const n of [0, 1, 2, 5]) {
      const p = new Presents();
      p.layout(L, GRID, SCENES.midnight, null, 'game', n);
      expect(p.gifts).toEqual(full.gifts.slice(0, n));
    }
    const p = new Presents();
    p.layout(L, GRID, SCENES.midnight, null, 'luxe', 40);
    expect(p.gifts).toEqual(full.gifts);
    p.layout(L, GRID, SCENES.midnight, null, 'game', 0);
    expect(p.bounds()).toBeNull();
  });

  it('the game set paints the game box and never the set painter', () => {
    paintSet.mockImplementation(() => {});
    new Presents().layout(L, GRID, SCENES.midnight, null, 'game');
    expect(paintSet).not.toHaveBeenCalled();
    expect(curves()).toBeGreaterThan(0);
  });

  it('the face paper keeps the game box under any set', () => {
    const faces = { ready: true, get: () => null } as unknown as FaceSprites;
    for (const set of ['luxe', 'kraft'] as const) {
      counts.clear();
      paintSet.mockClear();
      paintSet.mockImplementation(() => {});
      const p = new Presents();
      p.layout(L, GRID, SCENES.midnight, faces, set);
      expect(p.faceIndex).toBeGreaterThanOrEqual(0);
      expect(p.gifts[p.faceIndex].paper).toBe(FACE_PAPER);
      const painted = new Set(paintSet.mock.calls.map((a) => a[4]));
      expect([...painted].sort()).toEqual([0, 1, 2, 3, 4, 5].filter((i) => i !== p.faceIndex));
      // The face gift is the game's box (it draws curves: its bow), though the set painter is silent.
      expect(curves()).toBeGreaterThan(0);
    }
  });
});
