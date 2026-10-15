// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { FADE_MS } from '../../../src/render/aurora';
import { IDENTITY } from '../../../src/render/camera';
import { Renderer, type FrameInput } from '../../../src/render/renderer';
import { AURORA, HOME_ALONE, SCENES, type Scene } from '../../../src/render/scenes';
import { VisualState } from '../../../src/render/visual-state';

/** A 2D context that accepts everything. */
function sink(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (_x?: number, _y?: number, w = 1, h = 1) => {
        if (k === 'getImageData' || k === 'createImageData') return { data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h };
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop() {}, setTransform() {} };
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => sink()) as never);
  vi.stubGlobal('Path2D', class { moveTo(): void {} lineTo(): void {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A solved tree, every tile lit long ago (not won), on a 1280×800 stage. Tasks 3, 4 and 6 add tests that reuse it. */
function setup(scene: Scene = HOME_ALONE) {
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(scene);
  r.resize(1280, 800, 2);
  const solved = Board.random(GRID, mulberry32(7));
  const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
  const vis = new VisualState(GRID.cells.length);
  vis.onLightingChanged(board, board.lighting.order, [], 0, false);
  const frame = (now: number, over: Partial<FrameInput> = {}): FrameInput => ({
    board, vis, now, dt: 16, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion: false, ...over,
  });
  return { r, frame };
}

it('the house fades in over FADE_MS, then the sky settles; reduced motion asks for no fade', () => {
  const { r, frame } = setup(SCENES.midnight);
  r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  expect(r.sweeping).toBe(true);
  r.frame(frame(1000 + FADE_MS / 2));
  expect(r.sweeping).toBe(true);
  r.frame(frame(1000 + FADE_MS + 1));
  expect(r.sweeping).toBe(false);
  r.setScene(SCENES.midnight, { now: 5000, reduced: true, kind: 'fade' });
  expect(r.sweeping).toBe(false);
});

it("the window gags draw only in the house, faded with it, never during the head's sweep", () => {
  const { r, frame } = setup(SCENES.midnight);
  const draw = vi.spyOn(r.homeAlone, 'drawWindow');
  r.frame(frame(1000));
  expect(draw).not.toHaveBeenCalled();
  r.setScene(HOME_ALONE, { now: 2000, reduced: false, kind: 'fade' });
  r.frame(frame(2000 + FADE_MS / 2));
  expect(draw.mock.calls.at(-1)?.[2]).toBeCloseTo(0.5);
  r.frame(frame(2000 + FADE_MS + 10));
  expect(draw.mock.calls.at(-1)?.[2]).toBe(1);
  draw.mockClear();
  r.setScene(AURORA, { now: 5000, reduced: false });
  r.frame(frame(5100));
  expect(draw).not.toHaveBeenCalled();
});
