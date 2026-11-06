// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { D, L, R, U } from '../../../src/core/dirs';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { drawStrandBulb, drawStrandHalo } from '../../../src/render/bulbs';
import { IDENTITY } from '../../../src/render/camera';
import { tileGeometry } from '../../../src/render/geometry';
import { Renderer, strandStill, type FrameInput } from '../../../src/render/renderer';
import { SCENES } from '../../../src/render/scenes';
import { wireGlow, wireLit, wireUnlit } from '../../../src/render/strands/wire';
import { VisualState } from '../../../src/render/visual-state';
import { NO_DECOR, STARTER_LOOK, type Dress } from '../../../src/store/look';

// The real strand bulb, with the `still` flag of every call noted.
const stills: boolean[] = [];
vi.mock('../../../src/render/bulbs', async (actual) => {
  const real = await actual<typeof import('../../../src/render/bulbs')>();
  return {
    ...real,
    drawStrandBulb: vi.fn((...a: Parameters<typeof real.drawStrandBulb>) => {
      stills.push(a[9]);
      return real.drawStrandBulb(...a);
    }),
  };
});

type Call = [string, ...unknown[]];

/** A 2D context that accepts everything and records every call and property set, with a transform the strands read. */
function recorder(cv: HTMLCanvasElement | null = null): { c: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', canvas: cv };
  const c = new Proxy(state, {
    get(t, k) {
      if (k === 'getTransform') return () => ({ ...m });
      if (k === 'setTransform')
        return (a = 1, b = 0, cc = 0, d = 1, e = 0, f = 0) => {
          m = { a: a as number, b, c: cc, d, e, f };
          calls.push(['setTransform', a, b, cc, d, e, f]);
        };
      if (k === 'scale')
        return (x: number, y: number) => {
          m = { ...m, a: m.a * x, b: m.b * x, c: m.c * y, d: m.d * y };
          calls.push(['scale', x, y]);
        };
      if (k === 'rotate')
        return (r: number) => {
          const cs = Math.cos(r);
          const sn = Math.sin(r);
          m = { ...m, a: m.a * cs + m.c * sn, b: m.b * cs + m.d * sn, c: m.c * cs - m.a * sn, d: m.d * cs - m.b * sn };
          calls.push(['rotate', r]);
        };
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        calls.push([String(k), ...args.map((v) => (v instanceof HTMLCanvasElement ? 'canvas' : v))]);
        if (k === 'getImageData' || k === 'createImageData') return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop() {}, setTransform() {} };
        if (k === 'measureText') return { width: 1 };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      calls.push([`set:${String(k)}`, v]);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

beforeEach(() => {
  stills.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return recorder(this).c;
  } as never);
  vi.stubGlobal('Path2D', function Path2D() {
    return new Proxy({}, { get: () => () => {} });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const STRANDS = ['bubble', 'c9', 'candle'] as const;
const S = 40;

describe('each strand draws on a stub context', () => {
  for (const id of STRANDS) {
    it(`${id}: bulbs and halos for amt 0, 1 and above 1, every way round, moving and still`, () => {
      for (const sc of [SCENES.fireside, SCENES.midnight, SCENES.frost])
        for (const bits of [U, D, L, R])
          for (const amt of [0, 1, 1.4])
            for (const still of [false, true]) {
              const { c, calls } = recorder();
              expect(() => drawStrandBulb(c, id, bits, '#ff4060', amt, S, sc, 1234, 7, still)).not.toThrow();
              expect(() => drawStrandHalo(c, id, bits, '#ff4060', amt, S, 1234, 7, still)).not.toThrow();
              // Something is drawn: the bulb (lit or not) is never empty.
              expect(calls.some(([n]) => n === 'drawImage' || n === 'fill'), `${id} ${bits} ${amt}`).toBe(true);
            }
    });
    it(`${id}: its wire unlit, glowing and lit, mid-fill and whole, for an end, a straight, a bend and a tee`, () => {
      for (const bits of [U, U | D, U | R, U | L | R])
        for (const q of [0.5, 1]) {
          const prims = tileGeometry(bits, U);
          const { c } = recorder();
          const a = { q, alpha: 1, seed: 3, now: 1000, twinkleT: 1000 };
          expect(() => wireUnlit(c, id, prims, S, SCENES.fireside)).not.toThrow();
          expect(() => wireGlow(c, id, prims, S, SCENES.fireside, a)).not.toThrow();
          expect(() => wireLit(c, id, prims, S, SCENES.fireside, a)).not.toThrow();
        }
    });
  }
});

describe('still strands: nothing animated', () => {
  const drawn = (id: (typeof STRANDS)[number], now: number, still: boolean): Call[] => {
    const { c, calls } = recorder();
    for (const amt of [1, 1.3]) {
      drawStrandBulb(c, id, D, '#3a8aff', amt, S, SCENES.fireside, now, 5, still);
      drawStrandHalo(c, id, D, '#3a8aff', amt, S, now, 5, still);
    }
    return calls;
  };
  for (const id of ['bubble', 'candle'] as const) {
    it(`${id}: the same calls at two different times when still, different calls when moving`, () => {
      expect(drawn(id, 1000, true)).toEqual(drawn(id, 4321, true));
      expect(drawn(id, 1000, false)).not.toEqual(drawn(id, 4321, false));
    });
  }
  it('the strands go still under calm frames, reduced motion and a stepped-down quality tier, and move otherwise', () => {
    expect(strandStill(0, false, false)).toBe(false);
    expect(strandStill(0, true, false)).toBe(true);
    expect(strandStill(0, false, true)).toBe(true);
    expect(strandStill(1, false, false)).toBe(true);
    expect(strandStill(3, false, false)).toBe(true);
  });
});

describe('the renderer routes to the strand', () => {
  function setup(strand: Dress['strand']) {
    const r = new Renderer(document.createElement('canvas'));
    r.resize(390, 844, 2);
    r.setDress({ palette: 'scene', topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: 'none', garland: 'game', strand, tree: 'fir', pile: Infinity });
    const solved = Board.random(GRID, mulberry32(7));
    const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
    const vis = new VisualState(GRID.cells.length);
    vis.onLightingChanged(board, board.lighting.order, [], 0, false);
    const frame = (now: number, calm: boolean, reducedMotion = false): FrameInput => ({
      board, vis, now, dt: 16, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion, calm,
    });
    return { r, frame };
  }
  it('a strand other than bulbs draws every bulb through it: moving on a busy frame, still on a calm or reduced one', () => {
    const { r, frame } = setup('bubble');
    r.frame(frame(100_000, false));
    expect(stills.length).toBeGreaterThan(0);
    expect(stills.every((s) => s === false)).toBe(true);
    stills.length = 0;
    r.frame(frame(100_040, true));
    expect(stills.length).toBeGreaterThan(0);
    expect(stills.every((s) => s === true)).toBe(true);
    stills.length = 0;
    r.frame(frame(100_080, false, true));
    expect(stills.every((s) => s === true)).toBe(true);
  });
  it("the game's bulbs never touch a strand", () => {
    const { r, frame } = setup('bulbs');
    r.frame(frame(100_000, false));
    expect(stills).toEqual([]);
  });
  it('a strand change alone says the stage changed (the share image follows) without repainting the tree', () => {
    const { r } = setup('bulbs');
    const d: Dress = { palette: 'scene', topper: STARTER_LOOK.topper, decor: NO_DECOR, presents: 'none', garland: 'game', strand: 'c9', tree: 'fir', pile: Infinity };
    expect(r.setDress(d)).toBe(true);
    expect(r.setDress(d)).toBe(false);
  });
});
