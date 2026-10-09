// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Renderer } from '../../../src/render/renderer';
import { AURORA, SCENES } from '../../../src/render/scenes';

/** A 2D context that accepts everything: the renderer's layout-time painting only needs to run. */
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

it('the faces are laid out only in secret mode, never asked for in the other scenes', () => {
  const r = new Renderer(document.createElement('canvas'));
  vi.spyOn(r.topper, 'image', 'get').mockReturnValue({ naturalWidth: 240, naturalHeight: 256 } as HTMLImageElement);
  const get = vi.spyOn(r.faces, 'get');
  r.setScene(SCENES.midnight);
  r.resize(390, 844, 2);
  expect(r.faces.ready).toBe(true);
  expect(r.faceInfo()).toEqual({ tile: -1, gift: -1, garland: -1 });
  expect(get).not.toHaveBeenCalled();

  r.setScene(AURORA);
  const on = r.faceInfo();
  expect(on.gift).toBeGreaterThanOrEqual(0);
  expect(on.garland).toBeGreaterThanOrEqual(0);
  expect(get).toHaveBeenCalled();

  get.mockClear();
  r.setScene(SCENES.frost);
  expect(r.faceInfo()).toEqual({ tile: -1, gift: -1, garland: -1 });
  expect(get).not.toHaveBeenCalled();
});
