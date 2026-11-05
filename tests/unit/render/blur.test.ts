// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blurredLayer, clipBox } from '../../../src/render/blur';

interface Call {
  name: string;
  args: unknown[];
}

/** A 2D context that records its calls and what each canvas it was made for measured when asked. */
function recorder(log: Call[], canvas: { width: number; height: number }): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { canvas };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args: unknown[]) => log.push({ name: String(k), args });
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const DST = { width: 2560, height: 1600 };
let layers: { w: number; h: number; log: Call[] }[];
let dstLog: Call[];
let dst: CanvasRenderingContext2D;

beforeEach(() => {
  layers = [];
  dstLog = [];
  // The layer, as it was sized when its context was asked for (blurredLayer empties it afterwards).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const log: Call[] = [];
    layers.push({ w: this.width, h: this.height, log });
    return recorder(log, this);
  } as never);
  dst = recorder(dstLog, DST);
});
afterEach(() => vi.restoreAllMocks());

const lastDraw = (): unknown[] => dstLog.filter((c) => c.name === 'drawImage').at(-1)!.args;

describe('blurredLayer', () => {
  it('without a box it covers the whole canvas, as it always did', () => {
    const paint = vi.fn();
    blurredLayer(dst, 2, 3, paint);
    expect(layers[0]).toMatchObject({ w: 2560, h: 1600 });
    expect(layers[0].log.find((c) => c.name === 'setTransform')!.args).toEqual([2, 0, 0, 2, 0, 0]);
    expect(paint).toHaveBeenCalledOnce();
    expect(lastDraw().slice(1)).toEqual([0, 0, 2560, 1600]);
  });

  it('with a box its scratch canvas is the box, not the canvas, and it lands at the box', () => {
    blurredLayer(dst, 2, 3, vi.fn(), { x: 100, y: 50, w: 300, h: 200 });
    // Every canvas it made (the layer, and the fallback's downsample) is far smaller than the stage.
    for (const l of layers) expect(l.w * l.h).toBeLessThanOrEqual(300 * 200);
    expect(layers[0]).toMatchObject({ w: 300, h: 200 });
    // Painting stays in the same CSS px: the layer is shifted so the box's corner is its origin.
    expect(layers[0].log.find((c) => c.name === 'setTransform')!.args).toEqual([2, 0, 0, 2, -100, -50]);
    expect(lastDraw().slice(1)).toEqual([100, 50, 300, 200]);
  });

  it('a box is rounded out to whole pixels and clipped to the canvas; one outside draws nothing', () => {
    blurredLayer(dst, 2, 3, vi.fn(), { x: -20.5, y: 1500.2, w: 100, h: 500 });
    expect(layers[0]).toMatchObject({ w: 80, h: 100 });
    expect(lastDraw().slice(1)).toEqual([0, 1500, 80, 100]);
    layers.length = 0;
    dstLog.length = 0;
    const paint = vi.fn();
    blurredLayer(dst, 2, 3, paint, { x: 3000, y: 0, w: 10, h: 10 });
    expect(layers).toEqual([]);
    expect(paint).not.toHaveBeenCalled();
    expect(dstLog).toEqual([]);
  });
});

describe('clipBox', () => {
  it('rounds out and clips', () => {
    expect(clipBox({ x: 1.2, y: 2.7, w: 3.1, h: 1 }, 100, 100)).toEqual({ x: 1, y: 2, w: 4, h: 2 });
    expect(clipBox({ x: 90, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 });
    expect(clipBox({ x: 10, y: 10, w: 0, h: 5 }, 100, 100)).toBeNull();
  });
});
