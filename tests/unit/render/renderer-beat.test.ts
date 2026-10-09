// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { beatPulse, garlandBob, NOD_MS } from '../../../src/render/beat-fx';
import * as bulbs from '../../../src/render/bulbs';
import { IDENTITY } from '../../../src/render/camera';
import { Renderer, type BeatFrame, type FrameInput } from '../../../src/render/renderer';
import { AURORA } from '../../../src/render/scenes';
import { VisualState } from '../../../src/render/visual-state';

vi.mock('../../../src/render/bulbs', async (actual) => {
  const real = await actual<typeof import('../../../src/render/bulbs')>();
  return { ...real, drawBulb: vi.fn(), drawBulbHalo: vi.fn() };
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
  vi.mocked(bulbs.drawBulb).mockClear();
  vi.mocked(bulbs.drawBulbHalo).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A solved tree, every tile lit long ago (but not won), in secret mode. */
function setup() {
  const r = new Renderer(document.createElement('canvas'));
  r.setScene(AURORA);
  r.resize(390, 844, 2);
  const rng = mulberry32(7);
  const solved = Board.random(GRID, rng);
  const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
  const vis = new VisualState(GRID.cells.length);
  vis.onLightingChanged(board, board.lighting.order, [], 0, false);
  const frame = (now: number, beat?: BeatFrame, reducedMotion = false): FrameInput => ({
    board, vis, now, dt: 16, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion, beat,
  });
  return { r, frame };
}

/** What drawBulb was given, in order: unlit glass (pass 1, amount 0) or lit bulbs (pass 2). */
const drawn = (lit: boolean) => vi.mocked(bulbs.drawBulb).mock.calls.filter((c) => (c[3] > 0) === lit);

describe('the renderer on the beat (secret mode)', () => {
  it('steps every lit bulb one hue per strong beat; unlit glass and reduced motion keep their own', () => {
    const { r, frame } = setup();
    const n = AURORA.bulbs.length;
    const step = (c: string, k: number) => AURORA.bulbs[(AURORA.bulbs.indexOf(c) + k) % n];
    const colours = (beat?: BeatFrame, reduced = false) => {
      vi.mocked(bulbs.drawBulb).mockClear();
      vi.mocked(bulbs.drawBulbHalo).mockClear();
      r.frame(frame(20_000, beat, reduced));
      return {
        halo: vi.mocked(bulbs.drawBulbHalo).mock.calls.map((c) => c[1]),
        lit: drawn(true).map((c) => c[2]),
        glass: drawn(false).map((c) => c[2]),
      };
    };
    const plain = colours();
    expect(plain.lit.length).toBeGreaterThan(5);
    for (const hue of [1, 2, 7]) {
      const stepped = colours({ at: Number.NEGATIVE_INFINITY, strength: 0, hue });
      expect(stepped.halo).toEqual(plain.halo.map((c) => step(c, hue)));
      expect(stepped.lit).toEqual(plain.lit.map((c) => step(c, hue)));
      expect(stepped.glass).toEqual(plain.glass);
    }
    expect(colours({ at: Number.NEGATIVE_INFINITY, strength: 0, hue: 1 }, true)).toEqual(plain);
  });

  it('pulses the lit bulbs on a beat, then fades back', () => {
    const { r, frame } = setup();
    const amts = (beat?: BeatFrame, reduced = false) => {
      vi.mocked(bulbs.drawBulb).mockClear();
      r.frame(frame(20_000, beat, reduced));
      return drawn(true).map((c) => c[3]);
    };
    const rest = amts();
    expect(rest.length).toBeGreaterThan(5);
    const on = amts({ at: 20_000, strength: 1, hue: 0 });
    expect(on).toHaveLength(rest.length);
    on.forEach((a, k) => expect(a - rest[k]).toBeCloseTo(beatPulse(0, 1, false), 5));
    amts({ at: 20_000 - 2000, strength: 1, hue: 0 }).forEach((a, k) => expect(a - rest[k]).toBeLessThan(0.001));
    amts({ at: 20_000, strength: 1, hue: 0 }, true).forEach((a, k) => expect(a - rest[k]).toBeCloseTo(beatPulse(0, 1, true), 5));
  });

  it('nods the topper and bobs the garland face from the same beat', () => {
    const { r, frame } = setup();
    const nod = vi.spyOn(r.topper, 'nod');
    const face = vi.spyOn(r.garland, 'drawFace');
    const now = 20_000;
    r.frame(frame(now, { at: now - 0.3 * NOD_MS, strength: 0.8, hue: 0 }));
    expect(nod).toHaveBeenLastCalledWith(now - 0.3 * NOD_MS, 0.8);
    expect(face.mock.lastCall?.[6]).toBeCloseTo(garlandBob(now, now - 0.3 * NOD_MS, 0.8, false));
    r.frame(frame(now));
    expect(nod).toHaveBeenLastCalledWith(Number.NEGATIVE_INFINITY, 0);
    expect(face.mock.lastCall?.[6]).toBeCloseTo(garlandBob(now, Number.NEGATIVE_INFINITY, 0, false)); // the idle bob
    r.frame(frame(now, { at: now - 0.3 * NOD_MS, strength: 0.8, hue: 0 }, true));
    expect(face.mock.lastCall?.[6]).toBe(0);
  });
});
