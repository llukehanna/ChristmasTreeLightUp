// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../../../src/render/layout';
import { paintDecor, skirtBounds } from '../../../src/render/decor';
import { SCENES } from '../../../src/render/scenes';
import { NO_DECOR, type Decor } from '../../../src/store/look';

// A browser without canvas filters: blur.ts takes its downsample fallback.
vi.mock('../../../src/render/blur', async (actual) => {
  const real = await actual<typeof import('../../../src/render/blur')>();
  return { ...real, CANVAS_FILTER: false };
});

interface Call {
  name: string;
  args: unknown[];
}

class FakePath {
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
}

/** A 2D context that records every call and every property it is set to (as `set:name`), and keeps save/restore state. */
function recorder(log: Call[], canvas: { width: number; height: number }): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', canvas };
  const stack: Record<string | symbol, unknown>[] = [];
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(state, {
    get(t, k) {
      if (typeof k === 'string' && k in methods) return methods[k];
      if (k in t) return t[k];
      return (...args: unknown[]) => log.push({ name: String(k), args });
    },
    set(t, k, v) {
      t[k] = v;
      log.push({ name: `set:${String(k)}`, args: [v] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const L = computeLayout(1280, 800, 2);
const sc = SCENES.midnight;
let log: Call[];
let main: CanvasRenderingContext2D;
/** Every canvas made for a context during a paint, as sized when its context was asked for. */
let made: { w: number; h: number }[];

beforeEach(() => {
  log = [];
  made = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    made.push({ w: this.width, h: this.height });
    return recorder(log, this);
  } as never);
  vi.stubGlobal('Path2D', FakePath);
  main = recorder(log, { width: 2560, height: 1600 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const only = (k: keyof Decor): Decor => ({ ...NO_DECOR, [k]: true });
const count = (name: string): number => log.filter((c) => c.name === name).length;
const composites = (): unknown[] => log.filter((c) => c.name === 'set:globalCompositeOperation').map((c) => c.args[0]);

describe('paintDecor', () => {
  it('nothing is painted with every decoration off', () => {
    paintDecor(main, L, sc, NO_DECOR);
    expect(log).toEqual([]);
  });

  describe('each piece paints only when it is on', () => {
    // Each piece's signature: the skirt is laid behind the tree (destination-over); the beads' highlights are ellipses;
    // the tinsel strokes two dozen Path2D buckets of strands (the skirt's fur strokes only six); a cane is thousands of
    // shaded facets.
    const skirt = (): boolean => composites().includes('destination-over');
    const beads = (): boolean => count('ellipse') > 0;
    const tinsel = (): boolean => log.filter((c) => c.name === 'stroke' && c.args[0] instanceof FakePath).length > 12;
    const canes = (): boolean => count('fill') > 2000;

    it.each([
      ['skirt', [true, false, false, false]],
      ['beads', [false, true, false, false]],
      ['tinsel', [false, false, true, false]],
      ['canes', [false, false, false, true]],
    ] as const)('%s', (piece, expected) => {
      paintDecor(main, L, sc, only(piece));
      expect([skirt(), beads(), tinsel(), canes()]).toEqual(expected);
    });

    it('the skirt is composited behind what is already on the layer, then the context is put back', () => {
      paintDecor(main, L, sc, only('skirt'));
      expect(composites()).toEqual(['destination-over']);
      const at = log.findIndex((c) => c.name === 'set:globalCompositeOperation');
      expect(log[at + 1].name).toBe('drawImage');
      expect(log.filter((c) => c.name === 'save').length).toBe(log.filter((c) => c.name === 'restore').length);
    });
  });

  it('without canvas filters it never sets ctx.filter', () => {
    paintDecor(main, L, sc, { tinsel: true, beads: true, canes: true, skirt: true });
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    // The fallback composited the blurred layers instead: a drawImage of a layer onto a context.
    expect(count('drawImage')).toBeGreaterThan(6);
  });

  describe('layers are only as big as what they hold', () => {
    const FULL = 2560 * 1600;

    it('no layer it makes is anywhere near the whole canvas', () => {
      paintDecor(main, L, sc, { tinsel: true, beads: true, canes: true, skirt: true });
      // Garland shadows, cane shadows, the skirt's surface and its blurs, and the fallback's downsamples: a tier of
      // garland is the widest, about an eighth of the stage.
      expect(made.length).toBeGreaterThan(10);
      for (const m of made) expect(m.w * m.h).toBeLessThan(FULL * 0.25);
    });

    it('the skirt is painted on a surface the size of its bounds', () => {
      paintDecor(main, L, sc, only('skirt'));
      const b = skirtBounds(L);
      const w = Math.ceil(b.x1 * L.dpr) - Math.floor(b.x0 * L.dpr);
      const h = Math.ceil(b.y1 * L.dpr) - Math.floor(b.y0 * L.dpr);
      expect(made[0]).toEqual({ w, h });
      expect(w * h).toBeLessThan(FULL * 0.1);
    });

    it('each cane has its own small shadow layer', () => {
      paintDecor(main, L, sc, only('canes'));
      const layers = made.filter((m) => m.w * m.h > 0);
      expect(layers.length).toBeGreaterThanOrEqual(3);
      for (const m of layers) expect(m.w * m.h).toBeLessThan(FULL * 0.01);
    });
  });

  it('the skirt bounds hold its lowest paint: the floor shadow and the fur\'s blurred shadow', () => {
    const b = skirtBounds(L);
    const cy = L.oy + 10.22 * L.s;
    const ry = 0.58 * L.s;
    const T = 0.15 * L.s;
    expect(b.y1).toBeGreaterThanOrEqual(cy + ry * 1.35);
    expect(b.y1).toBeGreaterThanOrEqual(cy + ry * 1.01 + 2.5 * T);
    expect(b.x0).toBeLessThan(L.ox - 4.2 * L.s * 1.13);
    expect(b.x1).toBeGreaterThan(L.ox + 4.2 * L.s * 1.13);
  });
});
