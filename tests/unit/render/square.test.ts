// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paintBackdrop, type Backdrop } from '../../../src/render/backdrop';
import { Y, computeLayout } from '../../../src/render/layout';
import { SCENES } from '../../../src/render/scenes';
import { SquareLights } from '../../../src/render/square';
import { FakeMatrix, FakePath, drawn, matrices, recorder, type Call } from './backdrop-recorder';

// A browser without canvas filters: blur.ts takes its downsample fallback.
vi.mock('../../../src/render/blur', async (actual) => {
  const real = await actual<typeof import('../../../src/render/blur')>();
  return { ...real, CANVAS_FILTER: false };
});

const L = computeLayout(1280, 800, 2);
let log: Call[];
let main: CanvasRenderingContext2D;

beforeEach(() => {
  log = [];
  matrices.made = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return recorder(log, this);
  } as never);
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', FakeMatrix);
  main = recorder(log, { width: 2560, height: 1600 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The square painted, and its lights; the log emptied after the paint. */
function square(): SquareLights {
  const bd = paintBackdrop(main, L, SCENES.square);
  expect(bd).toBeInstanceOf(SquareLights);
  log.length = 0;
  return bd as SquareLights;
}
/** The blooms one glow pass draws. */
function blooms(bd: SquareLights, now: number, reduced: boolean, tier: number): ReturnType<typeof drawn> {
  log.length = 0;
  bd.glow(main, now, reduced, tier);
  return drawn(log);
}

describe('the Town square', () => {
  it('nothing moves behind the tree; the lights bloom only where they stand, on the far side of the square', () => {
    const bd = square();
    (bd as Backdrop).back(main, 1000, false, 0);
    expect(log).toEqual([]);
    const d = blooms(bd, 1000, false, 0);
    expect(d).toHaveLength(bd.glows.length);
    // The lamps, the carolers' lantern, the clock face and the brightest shop windows.
    expect(bd.glows.some((g) => g.shop)).toBe(true);
    expect(bd.glows.some((g) => !g.shop && g.flicker > 0)).toBe(true);
    const rink = Y(L, 10.05);
    d.forEach((q, i) => {
      const gl = bd.glows[i];
      // Each bloom is its own light's sprite, centred on the light and its radius wide.
      expect(q.x + q.w / 2).toBeCloseTo(gl.x);
      expect(q.y + q.h / 2).toBeCloseTo(gl.y);
      expect(q.w / 2).toBeCloseTo(gl.r);
      // Above the rink's edge: nothing blooms on the ice in front of the tree.
      expect(gl.y).toBeLessThan(rink);
      expect(gl.x).toBeGreaterThan(-L.s);
      expect(gl.x).toBeLessThan(L.w + L.s);
    });
  });

  it("tier 3 leaves out the shop windows' faint blooms; the lamps, lantern and clock bloom at every tier", () => {
    const bd = square();
    const lights = bd.glows.filter((g) => !g.shop).length;
    expect(lights).toBeGreaterThan(0);
    expect(lights).toBeLessThan(bd.glows.length);
    expect(blooms(bd, 1000, false, 0)).toHaveLength(bd.glows.length);
    expect(blooms(bd, 1016, false, 1)).toHaveLength(bd.glows.length);
    expect(blooms(bd, 1032, false, 2)).toHaveLength(bd.glows.length);
    expect(blooms(bd, 1048, false, 3)).toHaveLength(lights);
  });

  it("reduced motion steadies the lamps' flicker", () => {
    const bd = square();
    const a = blooms(bd, 1000, true, 0);
    expect(blooms(bd, 1700, true, 0)).toEqual(a);
    expect(a.map((q) => q.a)).toEqual(bd.glows.map((g) => g.a));
    // Without it the same moment flickers.
    expect(blooms(bd, 1700, false, 0).map((q) => q.a)).not.toEqual(blooms(bd, 2400, false, 0).map((q) => q.a));
  });

  it('no gradient, filter or matrix is created per frame', () => {
    const bd = square();
    const create = vi.spyOn(document, 'createElement');
    for (let k = 0; k < 10; k++) {
      (bd as Backdrop).back(main, 1000 + k * 16, false, 0);
      bd.glow(main, 1000 + k * 16, false, 0);
    }
    expect(log.filter((c) => c.name === 'createRadialGradient' || c.name === 'createLinearGradient')).toEqual([]);
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    expect(matrices.made).toBe(0);
    // The blooms are baked at paint: no canvas is made per frame either.
    expect(create).not.toHaveBeenCalled();
    expect(log.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(0);
    expect(main.globalAlpha).toBe(1);
  });

  it('without canvas filters the square still paints', () => {
    paintBackdrop(main, L, SCENES.square);
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    expect(log.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(100);
    // The blurred layers (the far side, the halation, the shop light on the snow and the ice, the figures) are
    // composited by the fallback instead.
    expect(log.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(5);
  });
});
