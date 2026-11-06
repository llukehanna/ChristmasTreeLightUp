// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { IDENTITY } from '../../../src/render/camera';
import { Renderer, type FrameInput } from '../../../src/render/renderer';
import { AURORA, SCENES } from '../../../src/render/scenes';
import { VisualState } from '../../../src/render/visual-state';
import { NO_DECOR, STARTER_LOOK, type Dress } from '../../../src/store/look';

// The real painters, each call counted.
const painted: string[] = [];
vi.mock('../../../src/render/trees/firs', async (actual) => {
  const real = await actual<typeof import('../../../src/render/trees/firs')>();
  return {
    paintFlocked: vi.fn((...a: Parameters<typeof real.paintFlocked>) => (painted.push('flocked'), real.paintFlocked(...a))),
    paintFeather: vi.fn((...a: Parameters<typeof real.paintFeather>) => (painted.push('feather'), real.paintFeather(...a))),
  };
});
vi.mock('../../../src/render/trees/tinsel', async (actual) => {
  const real = await actual<typeof import('../../../src/render/trees/tinsel')>();
  return { paintTinsel: vi.fn((...a: Parameters<typeof real.paintTinsel>) => (painted.push('tinsel'), real.paintTinsel(...a))) };
});

/** A 2D context that accepts everything. */
function sink(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (_x?: number, _y?: number, w = 1, h = 1) => {
        if (k === 'getImageData' || k === 'createImageData') return { data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h };
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop() {}, setTransform() {} };
        if (k === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        if (k === 'measureText') return { width: 1 };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  painted.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => sink()) as never);
  vi.stubGlobal('Path2D', function Path2D() {
    return new Proxy({}, { get: () => () => {} });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const dress = (tree: Dress['tree']): Dress => ({
  palette: 'scene', topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: 'none', garland: 'game', strand: 'bulbs', tree, pile: Infinity,
});

function frames(r: Renderer, n: number): void {
  const solved = Board.random(GRID, mulberry32(3));
  const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
  const vis = new VisualState(GRID.cells.length);
  vis.onLightingChanged(board, board.lighting.order, [], 0, false);
  for (let k = 0; k < n; k++) {
    const f: FrameInput = { board, vis, now: 100_000 + k * 16, dt: 16, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion: false };
    r.frame(f);
  }
}

for (const kind of ['flocked', 'feather', 'tinsel'] as const) {
  it(`the ${kind} tree is painted into the tree layer once per layout, never per frame`, () => {
    const r = new Renderer(document.createElement('canvas'));
    r.setDress(dress(kind));
    expect(painted).toEqual([]); // not sized yet: nothing to paint
    r.resize(1280, 800, 2);
    expect(painted).toEqual([kind]);
    frames(r, 12);
    expect(painted).toEqual([kind]);
    // The same dress again paints nothing; a new layout or scene paints it once more.
    r.setDress(dress(kind));
    expect(painted).toEqual([kind]);
    r.resize(390, 844, 3);
    r.setScene(SCENES.midnight);
    expect(painted).toEqual([kind, kind, kind]);
    frames(r, 6);
    expect(painted).toHaveLength(3);
  });
}

it('every scene light paints each tree kind without throwing; the fir stays the default', () => {
  const r = new Renderer(document.createElement('canvas'));
  r.resize(800, 600, 1);
  expect(painted).toEqual([]);
  for (const sc of [SCENES.fireside, SCENES.midnight, SCENES.frost, AURORA])
    for (const kind of ['flocked', 'feather', 'tinsel', 'fir'] as const) {
      r.setScene(sc);
      expect(() => r.setDress(dress(kind))).not.toThrow();
    }
  // A switch back to the fir paints none of the new trees.
  painted.length = 0;
  r.setDress(dress('feather'));
  r.setDress(dress('fir'));
  expect(painted).toEqual(['feather']);
});
