// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { IDENTITY } from '../../../src/render/camera';
import { skirtBottom } from '../../../src/render/decor';
import { Y, computeLayout } from '../../../src/render/layout';
import { drawUnlit } from '../../../src/render/paths';
import { Renderer, type FrameInput } from '../../../src/render/renderer';
import { SCENES } from '../../../src/render/scenes';
import { VisualState } from '../../../src/render/visual-state';
import { NO_DECOR, STARTER_LOOK, type Dress } from '../../../src/store/look';

// The real unlit painter, with its calls noted in the order the frame makes them.
const order: string[] = [];
vi.mock('../../../src/render/paths', async (actual) => {
  const real = await actual<typeof import('../../../src/render/paths')>();
  return { ...real, drawUnlit: vi.fn((...a: Parameters<typeof real.drawUnlit>) => { order.push('drawUnlit'); return real.drawUnlit(...a); }) };
});

type Log = { name: string; args: unknown[] }[];
const logs = new Map<HTMLCanvasElement, Log>();

/** A 2D context that accepts everything and records, per canvas, every call and every property set (as `set:name`). Asking a canvas for its context again starts its log afresh: the log is its latest paint. */
function sink(cv: HTMLCanvasElement, tap?: (name: string, args: unknown[]) => void): CanvasRenderingContext2D {
  const log: Log = [];
  logs.set(cv, log);
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', canvas: cv };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (_x?: number, _y?: number, w = 1, h = 1) => {
        log.push({ name: String(k), args: [_x, _y] });
        tap?.(String(k), [_x]);
        if (k === 'getImageData' || k === 'createImageData') return { data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h };
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop() {}, setTransform() {} };
        if (k === 'measureText') return { width: 1 };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      log.push({ name: `set:${String(k)}`, args: [v] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

let tree: HTMLCanvasElement;
beforeEach(() => {
  order.length = 0;
  logs.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return sink(this, (name, args) => {
      if (name === 'drawImage' && args[0] === tree) order.push('tree');
    });
  } as never);
  vi.stubGlobal('Path2D', class { moveTo(): void {} lineTo(): void {} quadraticCurveTo(): void {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('decorations are painted into the tree layer, which is drawn before the wires', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents };
  const r = new Renderer(document.createElement('canvas'));
  tree = (r as unknown as { tree: HTMLCanvasElement }).tree;
  r.setScene(SCENES.midnight);
  r.resize(1280, 800, 2);
  const painted = (): boolean => (logs.get(tree) ?? []).some((c) => c.name === 'set:globalCompositeOperation' && c.args[0] === 'destination-over');
  expect(painted()).toBe(false);

  // The skirt is laid behind the tree with destination-over: it lands on the tree canvas, not the sky's.
  r.setDress({ ...dress, decor: { ...NO_DECOR, skirt: true } });
  expect(painted()).toBe(true);
  // …and the transform is put back to identity for whatever draws the tree layer next.
  const sets = (logs.get(tree) ?? []).filter((c) => c.name === 'setTransform');
  expect(sets[sets.length - 1].args).toEqual([1, 0]);

  // In a frame the tree layer comes before the first wire.
  const solved = Board.random(GRID, mulberry32(7));
  const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
  const vis = new VisualState(GRID.cells.length);
  const frame: FrameInput = { board, vis, now: 100_000, dt: 16, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion: false };
  r.frame(frame);
  expect(order.indexOf('tree')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('drawUnlit')).toBeGreaterThan(order.indexOf('tree'));
  expect(drawUnlit).toHaveBeenCalled();
});

it('turning the decorations off repaints the tree layer without them', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents };
  const r = new Renderer(document.createElement('canvas'));
  tree = (r as unknown as { tree: HTMLCanvasElement }).tree;
  r.resize(1280, 800, 1);
  r.setDress({ ...dress, decor: { ...NO_DECOR, skirt: true } });
  r.setDress(dress);
  expect((logs.get(tree) ?? []).some((c) => c.name === 'set:globalCompositeOperation' && c.args[0] === 'destination-over')).toBe(false);
  expect((logs.get(tree) ?? []).some((c) => c.name === 'clearRect')).toBe(true);
});

it('the share image keeps the skirt: with it on the crop reaches its lowest paint, with it off it is unchanged', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents };
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(SCENES.midnight);
  r.resize(1280, 800, 2);
  const L = computeLayout(1280, 800, 2);
  const bottom = (): number => { const t = r.treeRect(); return t.y + t.h; };
  // Off: the tree's rows and the presents, as before.
  const off = bottom();
  expect(off).toBeGreaterThanOrEqual(Y(L, 10.8) * 2);
  // On: the fur, its hairs and the floor shadow are inside the crop (the presents alone stop short of them).
  r.setDress({ ...dress, decor: { ...NO_DECOR, skirt: true } });
  expect(off).toBeLessThan(skirtBottom(L) * 2);
  expect(bottom()).toBeGreaterThanOrEqual(skirtBottom(L) * 2 - 1e-6);
  // The other three hang on the tree and need no more room.
  r.setDress({ ...dress, decor: { ...NO_DECOR, tinsel: true, beads: true, canes: true } });
  expect(bottom()).toBe(off);
});

it('with no presents the share rectangle is the tree alone', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: 'game' };
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(SCENES.midnight);
  r.resize(1280, 800, 2);
  const L = computeLayout(1280, 800, 2);
  r.setDress(dress);
  const withGifts = r.treeRect();
  // The game's presents flank the tree beyond its columns, so they widen the crop.
  expect(withGifts.w).toBeGreaterThan(21 * L.s * 2);

  r.setDress({ ...dress, presents: 'none' });
  const tree = r.treeRect();
  expect(tree.x).toBeCloseTo((L.ox - 10.5 * L.s) * 2);
  expect(tree.w).toBeCloseTo(21 * L.s * 2);
  expect(tree.y).toBeCloseTo(Y(L, -2.8) * 2);
  expect(tree.y + tree.h).toBeCloseTo(Y(L, 10.8) * 2);

  // …and with the skirt on, the tree and its skirt.
  r.setDress({ ...dress, presents: 'none', decor: { ...NO_DECOR, skirt: true } });
  const t = r.treeRect();
  expect(t.x).toBeCloseTo(tree.x);
  expect(t.y + t.h).toBeCloseTo(skirtBottom(L) * 2);
});
