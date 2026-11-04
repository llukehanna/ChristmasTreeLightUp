// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { IDENTITY } from '../../../src/render/camera';
import { Renderer, type FrameInput } from '../../../src/render/renderer';
import { AURORA } from '../../../src/render/scenes';
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

function setup() {
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(AURORA);
  r.resize(390, 844, 2);
  const solved = Board.random(GRID, mulberry32(7));
  const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
  const vis = new VisualState(GRID.cells.length);
  vis.onLightingChanged(board, board.lighting.order, [], 0, false);
  const frame = (now: number, dt: number, calm: boolean): FrameInput => ({
    board, vis, now, dt, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion: false, calm,
  });
  return { r, frame };
}

describe('the quality governor under calm frames', () => {
  // 75 Hz draws every third frame (40 ms); 240 Hz every seventh (29.2 ms): both outside the governor's "capped" band.
  it.each([40, 29.2])('an idle %s ms calm cadence leaves the tier at 0', (dt) => {
    const { r, frame } = setup();
    for (let k = 1; k <= 300; k++) r.frame(frame(100_000 + k * dt, dt, true));
    expect(r.quality.tier).toBe(0);
  });
  it('the same cadence on busy frames still reads as a slow device', () => {
    const { r, frame } = setup();
    for (let k = 1; k <= 300; k++) r.frame(frame(100_000 + k * 40, 40, false));
    expect(r.quality.tier).toBeGreaterThan(0);
  });
});
