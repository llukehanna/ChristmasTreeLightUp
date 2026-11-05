// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENES, type Scene } from '../../../src/render/scenes';
import { withPalette } from '../../../src/render/palettes';
import { drawArt, drawArtGlow, prepareArt, type ArtKind } from '../../../src/render/topper-art';

interface Call {
  name: string;
  args: unknown[];
  alpha: number;
  op: string;
}

/** A 2D context that records every call with the opacity and blend it was made at, and keeps save/restore state. */
function recorder(log: Call[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const stack: Record<string | symbol, unknown>[] = [];
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }),
  };
  return new Proxy(state, {
    get(t, k) {
      if (typeof k === 'string' && k in methods) return methods[k];
      if (k in t) return t[k];
      return (...args: unknown[]) => log.push({ name: String(k), args, alpha: t.globalAlpha as number, op: t.globalCompositeOperation as string });
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const S = 30;
let log: Call[];
let canvas2d: boolean;
let made: number;
// Every test its own size, so the module's sprite cache never carries one test's sprites into the next.
let size = S;

beforeEach(() => {
  log = [];
  canvas2d = true;
  made = 0;
  size += 1;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    made++;
    return canvas2d ? recorder([]) : null;
  }) as unknown as HTMLCanvasElement['getContext']);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom has no matchMedia: a touch screen (no hover, a coarse pointer) or a desktop. */
const touchScreen = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(hover: none) and (pointer: coarse)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));

const images = () => log.filter((c) => c.name === 'drawImage');

describe('the topper art', () => {
  it('is built once per kind, size, dpr and scene, then found in the cache', () => {
    prepareArt('angel', size, 2, SCENES.midnight);
    const built = made;
    expect(built).toBeGreaterThan(0);
    prepareArt('angel', size, 2, SCENES.midnight);
    expect(made).toBe(built);
    // A palette that changes the glow, another dpr, and another kind each build their own.
    prepareArt('angel', size, 2, withPalette(SCENES.midnight, 'gilded'));
    expect(made).toBeGreaterThan(built);
    const gilded = made;
    prepareArt('angel', size, 1, SCENES.midnight);
    expect(made).toBeGreaterThan(gilded);
  });

  it('two scenes with one glow (a palette sets it for both) still get their own light', () => {
    const a: Scene = withPalette(SCENES.midnight, 'gilded');
    const b: Scene = withPalette(SCENES.frost, 'gilded');
    expect(a.glow).toBe(b.glow);
    prepareArt('bow', size, 2, a);
    const built = made;
    prepareArt('bow', size, 2, b);
    expect(made).toBeGreaterThan(built);
  });

  it('before the win: the dim sprite, then the lit one at the warmth the tree gives, and no emit', () => {
    prepareArt('angel', size, 2, SCENES.midnight);
    drawArt('angel', recorder(log), size, SCENES.midnight, { glow: 0, on: 0 }, false, 0.5, 0);
    expect(images()).toHaveLength(2);
    expect(images()[0].alpha).toBe(1);
    expect(images()[1].alpha).toBeCloseTo(0.55 * 0.5 * 0.5, 6);
    expect(log.some((c) => c.op === 'lighter')).toBe(false);
  });

  it('on the win: lit at 0.55 + 0.45·on, with the emit sprite added at on × the kind\'s strength', () => {
    const strength: Record<ArtKind, number> = { bow: 0.12, angel: 0.26, snowflake: 0.32 };
    for (const kind of ['bow', 'angel', 'snowflake'] as const) {
      log = [];
      prepareArt(kind, size, 2, SCENES.fireside);
      // now = 0: the emit's shimmer (0.9 + 0.1·sin) is at 0.9.
      drawArt(kind, recorder(log), size, SCENES.fireside, { glow: 1, on: 0.5 }, true, 1, 0);
      const [dim, lit, emit] = images();
      expect(dim.alpha, kind).toBe(1);
      expect(lit.alpha, kind).toBeCloseTo(0.55 + 0.45 * 0.5, 6);
      expect(emit.op, kind).toBe('lighter');
      expect(emit.alpha, kind).toBeCloseTo(0.5 * strength[kind] * 0.9, 6);
    }
  });

  it('a tap\'s flash (on above 0 before the win) adds the emit, so the flare reads on every topper', () => {
    prepareArt('bow', size, 2, SCENES.frost);
    drawArt('bow', recorder(log), size, SCENES.frost, { glow: 0, on: 0.6 }, false, 0, 0);
    expect(images().some((c) => c.op === 'lighter')).toBe(true);
  });

  it('draws at the opacity it is given (a crossfade)', () => {
    prepareArt('angel', size, 2, SCENES.midnight);
    const c = recorder(log);
    c.globalAlpha = 0.5;
    drawArt('angel', c, size, SCENES.midnight, { glow: 0, on: 0 }, false, 0, 0);
    expect(images()[0].alpha).toBe(0.5);
  });

  it('its glow: faint as the tree fills, full on the win, and nothing on a dark tree', () => {
    prepareArt('snowflake', size, 2, SCENES.midnight);
    drawArtGlow('snowflake', recorder(log), size, SCENES.midnight, { glow: 0, on: 0 }, false, 0, 0);
    expect(images()).toHaveLength(0);
    drawArtGlow('snowflake', recorder(log), size, SCENES.midnight, { glow: 0, on: 0 }, false, 1, 0);
    expect(images()[0].alpha).toBeCloseTo(0.25, 6);
    log = [];
    drawArtGlow('snowflake', recorder(log), size, SCENES.midnight, { glow: 1, on: 1 }, true, 1, 0);
    expect(images()[0].alpha).toBeCloseTo(0.9, 6);
  });

  it('without a 2D context: the star stands in, built once rather than every frame', () => {
    canvas2d = false;
    expect(() => prepareArt('angel', size, 2, SCENES.midnight)).not.toThrow();
    const tried = made;
    for (let k = 0; k < 3; k++) drawArt('angel', recorder(log), size, SCENES.midnight, { glow: 0, on: 0 }, false, 0, k);
    expect(made).toBe(tried);
    expect(images()).toHaveLength(0);
    expect(log.some((c) => c.name === 'fill')).toBe(true); // the star's glass
  });

  it('on a touch screen the sprites have twice the pixels, for a pinch-zoom; still none built during a frame', () => {
    const make = vi.spyOn(document, 'createElement');
    const widest = (): [number, number] => {
      const made = make.mock.results.map((r) => r.value as HTMLCanvasElement).filter((c) => c instanceof HTMLCanvasElement);
      return [Math.max(...made.map((c) => c.width)), Math.max(...made.map((c) => c.height))];
    };
    touchScreen(false);
    prepareArt('snowflake', size, 2, SCENES.midnight);
    const [w, h] = widest();
    expect(w).toBe(2 * size * 2); // the snowflake's box is 2 tiles wide, at dpr 2
    make.mockClear();
    touchScreen(true);
    prepareArt('snowflake', size, 2, SCENES.midnight);
    expect(widest()).toEqual([2 * w, 2 * h]);
    make.mockClear();
    drawArt('snowflake', recorder(log), size, SCENES.midnight, { glow: 1, on: 1 }, true, 1, 0);
    drawArtGlow('snowflake', recorder(log), size, SCENES.midnight, { glow: 1, on: 1 }, true, 1, 0);
    expect(make.mock.calls.filter((c) => c[0] === 'canvas')).toHaveLength(0);
    // …drawn at the same size on the stage: drawImage scales them.
    expect(images()[0].args.slice(3)).toEqual([2 * size, 2 * size]);
  });

  it('a draw before any prepare builds its sprites rather than failing', () => {
    expect(() => drawArt('bow', recorder(log), size + 100, SCENES.midnight, { glow: 0, on: 0 }, false, 0, 0)).not.toThrow();
    expect(images().length).toBeGreaterThan(0);
  });
});
