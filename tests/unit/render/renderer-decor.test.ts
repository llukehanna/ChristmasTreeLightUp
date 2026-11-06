// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { IDENTITY } from '../../../src/render/camera';
import { skirtBottom } from '../../../src/render/decor';
import { Y, computeLayout } from '../../../src/render/layout';
import { ParlourRoom } from '../../../src/render/parlour';
import { drawUnlit } from '../../../src/render/paths';
import { Renderer, type FrameInput } from '../../../src/render/renderer';
import { withPalette } from '../../../src/render/palettes';
import { SCENES } from '../../../src/render/scenes';
import { SquareLights } from '../../../src/render/square';
import { Snowfall as WindowSnow } from '../../../src/render/window-kit';
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
  // A path that accepts every call (the Sash's room builds its glass with rects and arcs).
  vi.stubGlobal('Path2D', class { constructor() { return new Proxy(this, { get: () => () => {} }); } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('decorations are painted into the tree layer, which is drawn before the wires', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents, garland: STARTER_LOOK.garland, pile: Infinity };
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
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents, garland: STARTER_LOOK.garland, pile: Infinity };
  const r = new Renderer(document.createElement('canvas'));
  tree = (r as unknown as { tree: HTMLCanvasElement }).tree;
  r.resize(1280, 800, 1);
  r.setDress({ ...dress, decor: { ...NO_DECOR, skirt: true } });
  r.setDress(dress);
  expect((logs.get(tree) ?? []).some((c) => c.name === 'set:globalCompositeOperation' && c.args[0] === 'destination-over')).toBe(false);
  expect((logs.get(tree) ?? []).some((c) => c.name === 'clearRect')).toBe(true);
});

it('the share image keeps the skirt: with it on the crop reaches its lowest paint, with it off it is unchanged', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents, garland: STARTER_LOOK.garland, pile: Infinity };
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
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: 'game', garland: STARTER_LOOK.garland, pile: Infinity };
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(SCENES.midnight);
  r.resize(1280, 800, 2);
  const L = computeLayout(1280, 800, 2);
  r.setDress(dress);
  const withGifts = r.treeRect();
  // The game's presents flank the tree beyond its columns, so they widen the crop.
  expect(withGifts.w).toBeGreaterThan(21 * L.s * 2);

  // A pile of none is the tree alone too; the pile's change repaints.
  expect(r.setDress({ ...dress, pile: 0 })).toBe(true);
  expect(r.treeRect().w).toBeCloseTo(21 * L.s * 2);
  expect(r.setDress({ ...dress, pile: 0 })).toBe(false);
  r.setDress(dress);

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

it("a dress change keeps the Sash's backdrop and its snow; a resize or a change of scene paints it afresh", () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents, garland: STARTER_LOOK.garland, pile: Infinity };
  vi.stubGlobal('DOMMatrix', class { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; }); // jsdom has none (the snow's sheets use one)
  const r = new Renderer(document.createElement('canvas'));
  const backdrop = () => (r as unknown as { backdrop: unknown }).backdrop;
  r.setScene(SCENES.sash);
  r.resize(1280, 800, 2);
  const first = backdrop();
  expect(first).toBeInstanceOf(WindowSnow);

  // Live picks in the Decorate drawer: the flakes keep falling where they were.
  r.setDress({ ...dress, decor: { ...NO_DECOR, tinsel: true } });
  r.setDress({ ...dress, topper: 'angel', presents: 'kraft' });
  expect(backdrop()).toBe(first);
  // A palette is a new scene object with the same id (withPalette): still the same room.
  r.setScene(withPalette(SCENES.sash, 'ice'));
  expect(backdrop()).toBe(first);

  r.resize(1024, 768, 2);
  const resized = backdrop();
  expect(resized).toBeInstanceOf(WindowSnow);
  expect(resized).not.toBe(first);

  r.setScene(SCENES.midnight);
  expect(backdrop()).toBeNull();
  r.setScene(SCENES.sash);
  expect(backdrop()).toBeInstanceOf(WindowSnow);
  expect(backdrop()).not.toBe(resized);
});

it("swapping between the rooms live paints each one afresh, and a resize re-bakes the Parlour's flame for the new screen", () => {
  vi.stubGlobal('DOMMatrix', class { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; });
  const r = new Renderer(document.createElement('canvas'));
  const backdrop = () => (r as unknown as { backdrop: unknown }).backdrop;
  r.setScene(SCENES.sash);
  r.resize(1280, 800, 2);
  const sash = backdrop();
  expect(sash).toBeInstanceOf(WindowSnow);
  r.setScene(SCENES.square);
  expect(backdrop()).toBeInstanceOf(SquareLights);
  r.setScene(SCENES.parlour);
  const parlour = backdrop() as ParlourRoom;
  expect(parlour).toBeInstanceOf(ParlourRoom);
  // Back to the square: its own lights again, never the parlour's room or the first square's.
  r.setScene(SCENES.square);
  expect(backdrop()).toBeInstanceOf(SquareLights);
  r.setScene(SCENES.parlour);
  const again = backdrop() as ParlourRoom;
  expect(again).not.toBe(parlour);
  expect(again.room.spr.flame.width).toBe(parlour.room.spr.flame.width);
  // The flame is baked at twice device resolution: a screen at dpr 1 gets a smaller one, and the room is laid out anew.
  r.resize(1280, 800, 1);
  const resized = backdrop() as ParlourRoom;
  expect(resized).not.toBe(again);
  expect(resized.room.spr.flame.width).toBeLessThan(again.room.spr.flame.width);
  r.setScene(SCENES.fireside);
  expect(backdrop()).toBeNull();
});

it('setDress says whether it repainted: a real change does, the same dress or a palette alone (the scene carries it) does not', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents, garland: STARTER_LOOK.garland, pile: Infinity };
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(SCENES.midnight);
  r.resize(1280, 800, 1);
  const repaint = vi.spyOn(r as unknown as { repaint(): void }, 'repaint');
  expect(r.setDress({ ...dress, decor: { ...NO_DECOR } })).toBe(false);
  expect(r.setDress({ ...dress, palette: 'ice' })).toBe(false);
  expect(repaint).not.toHaveBeenCalled();
  expect(r.setDress({ ...dress, palette: 'ice', topper: 'angel' })).toBe(true);
  expect(r.setDress({ ...dress, palette: 'ice', topper: 'angel', presents: 'luxe' })).toBe(true);
  expect(r.setDress({ ...dress, palette: 'ice', topper: 'angel', presents: 'luxe', decor: { ...NO_DECOR, beads: true } })).toBe(true);
  expect(repaint).toHaveBeenCalledTimes(3);
});

it('a garland change alone repaints the garland, never the tree layer', () => {
  const dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: STARTER_LOOK.presents, garland: 'game', pile: Infinity };
  const r = new Renderer(document.createElement('canvas'));
  tree = (r as unknown as { tree: HTMLCanvasElement }).tree;
  r.resize(1280, 800, 1);
  r.setDress(dress);
  logs.clear();
  const paint = vi.spyOn(r.garland, 'paint');
  const set = vi.spyOn(r.garland, 'setSet');
  expect(r.setDress({ ...dress, garland: 'gold' })).toBe(true);
  expect(set).toHaveBeenLastCalledWith('gold');
  expect(paint).toHaveBeenCalledTimes(1);
  expect(logs.has(tree)).toBe(false);
  expect(r.setDress({ ...dress, garland: 'gold' })).toBe(false);
  expect(paint).toHaveBeenCalledTimes(1);
});
