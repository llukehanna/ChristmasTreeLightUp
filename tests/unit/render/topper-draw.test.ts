// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../../../src/render/layout';
import { SCENES } from '../../../src/render/scenes';
import * as beatFx from '../../../src/render/beat-fx';
import { NOD_DIP, NOD_MS } from '../../../src/render/beat-fx';
import { drawStarBody } from '../../../src/render/effects';
import { drawArt, starTint } from '../../../src/render/topper-art';
import { BURST_MS, FADE_MS, FLIP_MS, Topper, WOBBLE_MS } from '../../../src/render/topper';
import type { TopperKind } from '../../../src/store/look';

// Spies over the real painters: which face a frame drew.
vi.mock('../../../src/render/effects', async (actual) => {
  const real = await actual<typeof import('../../../src/render/effects')>();
  return { ...real, drawStarBody: vi.fn(real.drawStarBody) };
});
vi.mock('../../../src/render/topper-art', async (actual) => {
  const real = await actual<typeof import('../../../src/render/topper-art')>();
  return { ...real, drawArt: vi.fn(real.drawArt) };
});

interface Call {
  name: string;
  args: unknown[];
  alpha: number;
}

/** A 2D context that records every call (with the opacity it was made at) and keeps save/restore state. */
function recorder(log: Call[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const stack: Record<string | symbol, unknown>[] = [];
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  return new Proxy(state, {
    get(t, k) {
      if (typeof k === 'string' && k in methods) return methods[k];
      if (k in t) return t[k];
      return (...args: unknown[]) => log.push({ name: String(k), args, alpha: t.globalAlpha as number });
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** The sticker, as the browser would load it (or fail to). */
class FakeImage {
  static fail = false;
  static made = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = '';
  naturalWidth = 240;
  naturalHeight = 256;
  constructor() {
    FakeImage.made++;
  }
  set src(_: string) {
    queueMicrotask(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()));
  }
}

const L = computeLayout(1280, 800, 2);
const sc = SCENES.midnight;
const dim = { glow: 0, on: 0 };
let log: Call[];
let cacheContexts: number;
let canvas2d: boolean;

beforeEach(() => {
  log = [];
  cacheContexts = 0;
  canvas2d = true;
  FakeImage.fail = false;
  FakeImage.made = 0;
  vi.stubGlobal('Image', FakeImage);
  vi.mocked(drawStarBody).mockClear();
  vi.mocked(drawArt).mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => {
    cacheContexts++;
    return canvas2d ? recorder([]) : null;
  }) as unknown as HTMLCanvasElement['getContext']);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const frame = (t: Topper, now: number, reduced = false) => t.draw(recorder(log), L, sc, dim, false, 0.3, now, null, reduced, 2);
const calls = (name: string) => log.filter((c) => c.name === name);

describe('the topper falls back to the star', () => {
  it('when the sticker 404s or fails to decode: load() says so, the star is drawn, and a later load tries again', async () => {
    FakeImage.fail = true;
    const t = new Topper();
    t.set(true);
    expect(await t.load()).toBe(false);
    expect(t.ready).toBe(false);
    frame(t, 1000);
    expect(calls('drawImage')).toHaveLength(0);
    expect(calls('fill').length).toBeGreaterThan(0); // the star's glass
    FakeImage.fail = false;
    expect(await t.load()).toBe(true);
    expect(FakeImage.made).toBe(2);
  });

  it('when no 2D context can be had for the cache: the star, every frame, without throwing or retrying each frame', async () => {
    canvas2d = false;
    const t = new Topper();
    t.set(true);
    expect(await t.load()).toBe(true);
    for (let k = 0; k < 5; k++) expect(() => frame(t, 1000 + k * 16)).not.toThrow();
    expect(calls('drawImage')).toHaveLength(0);
    expect(calls('fill').length).toBeGreaterThan(0);
    expect(cacheContexts).toBe(1); // tried once, then given up
    expect(t.ready).toBe(false);
    expect(await t.load()).toBe(false); // the egg then won't turn to a head it can't draw
  });

  it('a stored head still decoding draws nothing, rather than a star that pops into a head', () => {
    const t = new Topper();
    t.set(true);
    void t.load();
    frame(t, 1000);
    expect(calls('fill')).toHaveLength(0);
    expect(calls('drawImage')).toHaveLength(0);
  });
});

describe('drawing the head', () => {
  it('the dim sticker, then the lit one over it at the light the tree gives', async () => {
    const t = new Topper();
    t.set(true);
    await t.load();
    frame(t, 5000);
    const images = calls('drawImage');
    expect(images).toHaveLength(2);
    expect(images[0].alpha).toBe(1);
    expect(images[1].alpha).toBeCloseTo(0.35 * 0.3 ** 5, 6);
  });

  it('asks for frames while paused only until a load or a flip has settled', async () => {
    const t = new Topper();
    await t.load();
    expect(t.needsFrame(0)).toBe(true); // just loaded
    frame(t, 0);
    expect(t.needsFrame(0)).toBe(false);
    t.flip(true, 100);
    expect(t.needsFrame(100 + FLIP_MS)).toBe(true);
    expect(t.needsFrame(100 + FLIP_MS + BURST_MS + 1)).toBe(false);
  });
});

describe('reduced motion', () => {
  it('a 300 ms crossfade: both faces at complementary opacity, nothing turned, squeezed or thrown', async () => {
    const t = new Topper();
    t.set(false);
    await t.load();
    frame(t, 0, true);
    t.flip(true, 1000);
    log = [];
    frame(t, 1000 + FADE_MS / 2, true);
    const starFill = calls('fill')[0];
    const headDim = calls('drawImage')[0];
    expect(starFill.alpha).toBeCloseTo(0.5, 6);
    expect(headDim.alpha).toBeCloseTo(0.5, 6);
    expect(calls('rotate').every((c) => c.args[0] === 0)).toBe(true);
    expect(calls('scale').every((c) => c.args[0] === c.args[1] || c.args[0] === 1)).toBe(true);
    // Past the burst's start: under reduced motion there are no flecks (fillRect) or twinkles (quadraticCurveTo).
    log = [];
    frame(t, 1000 + FLIP_MS / 2 + 200, true);
    expect(calls('fillRect')).toHaveLength(0);
    expect(calls('quadraticCurveTo')).toHaveLength(0);
    expect(calls('fill')).toHaveLength(0); // the crossfade is over: the head alone
  });

  it('without it: the flip squeezes the face and throws the burst', async () => {
    const t = new Topper();
    t.set(false);
    await t.load();
    t.flip(true, 1000);
    frame(t, 1000 + FLIP_MS * 0.4);
    expect(calls('scale').some((c) => (c.args[0] as number) < 0.9 && c.args[1] === 1)).toBe(true);
    log = [];
    frame(t, 1000 + FLIP_MS / 2 + 200);
    expect(calls('fillRect').length).toBeGreaterThan(20);
    expect(calls('quadraticCurveTo').length).toBeGreaterThan(0);
  });

  it('a toggle back during a reduced-motion crossfade starts from the face that shows', async () => {
    const t = new Topper();
    t.set(false);
    await t.load();
    frame(t, 0, true);
    t.flip(true, 1000);
    // 240 ms in: the crossfade shows mostly the head (a flip's timing would still say the star).
    frame(t, 1000 + FADE_MS * 0.8, true);
    t.flip(false, 1000 + FADE_MS * 0.8);
    log = [];
    frame(t, 1000 + FADE_MS * 0.8 + 1, true);
    // So the way back fades the head out, rather than snapping it away.
    const head = calls('drawImage')[0];
    expect(head?.alpha).toBeGreaterThan(0.9);
    t.flip(true, 5000); // and a crossfade that has finished starts from the face at rest
    log = [];
    frame(t, 5001, true);
    expect(calls('fill')[0]?.alpha).toBeGreaterThan(0.9);
  });
});

describe('the nod (secret mode)', () => {
  it('dips the head on a beat and brings it back; never under reduced motion', async () => {
    const t = new Topper();
    t.attachBeat(beatFx);
    t.set(true);
    await t.load();
    const y = (reduced: boolean, at: number, now: number): number => {
      const calls: Call[] = [];
      t.nod(at, 1);
      t.draw(recorder(calls), L, sc, dim, false, 0, now, null, reduced, 2);
      return calls.find((c) => c.name === 'translate')?.args[1] as number;
    };
    const rest = y(false, Number.NEGATIVE_INFINITY, 5000);
    expect(y(false, 5000 - 0.3 * NOD_MS, 5000) - rest).toBeCloseTo(NOD_DIP * L.s, 5);
    expect(y(false, 5000 - NOD_MS, 5000)).toBeCloseTo(rest, 5);
    expect(y(true, 5000 - 0.3 * NOD_MS, 5000)).toBeCloseTo(rest, 5);
  });

  it('before the eggs load there is no nod: a beat leaves the head where it is', async () => {
    const t = new Topper();
    t.set(true);
    await t.load();
    const y = (at: number): number => {
      const calls: Call[] = [];
      t.nod(at, 1);
      t.draw(recorder(calls), L, sc, dim, false, 0, 5000, null, false, 2);
      return calls.find((c) => c.name === 'translate')?.args[1] as number;
    };
    expect(y(5000 - 0.3 * NOD_MS)).toBeCloseTo(y(Number.NEGATIVE_INFINITY), 5);
  });
});

describe('the other toppers', () => {
  const KINDS: readonly TopperKind[] = ['star', 'silverstar', 'goldstar', 'snowflake', 'angel', 'bow'];

  it('each kind draws its own art, not the star body', () => {
    const t = new Topper();
    t.setKind('snowflake');
    frame(t, 1000);
    expect(drawStarBody).not.toHaveBeenCalled();
    expect(drawArt).toHaveBeenCalled();
    expect(vi.mocked(drawArt).mock.calls[0][0]).toBe('snowflake');
  });

  it('the silver and gold stars are the star recoloured: its body in their own glass and light, never the art', () => {
    for (const kind of ['silverstar', 'goldstar'] as const) {
      vi.mocked(drawStarBody).mockClear();
      const t = new Topper();
      t.setKind(kind);
      t.prepare(L, sc);
      frame(t, 1000);
      expect(drawArt, kind).not.toHaveBeenCalled();
      expect(drawStarBody, kind).toHaveBeenCalledTimes(1);
      const drawn = vi.mocked(drawStarBody).mock.calls[0][2];
      expect(drawn, kind).toBe(starTint(sc, kind));
      expect([drawn.starOff, drawn.starEdge, drawn.core, drawn.glow], kind).not.toEqual([sc.starOff, sc.starEdge, sc.core, sc.glow]);
      // The rest of the scene is the scene's.
      expect(drawn.bulbs).toBe(sc.bulbs);
      // The win's halo and flare (drawStarGlow) take the star's light too.
      expect(t.tint(sc), kind).toBe(drawn);
    }
    expect(starTint(sc, 'silverstar').glow).not.toBe(starTint(sc, 'goldstar').glow);
  });

  it('the gold star keeps the daylight edge readable on Frost', () => {
    expect(starTint(SCENES.frost, 'goldstar').starEdge).toBe(SCENES.frost.starEdge);
  });

  it('the star and the art toppers keep the scene for the halo', () => {
    for (const kind of ['star', 'angel', 'snowflake', 'bow'] as const) {
      const t = new Topper();
      t.setKind(kind);
      expect(t.tint(sc), kind).toBe(sc);
    }
  });

  it('a flip from the snowflake to the head shows the snowflake leaving', async () => {
    const t = new Topper();
    t.setKind('snowflake');
    await t.load();
    t.flip(true, 1000);
    frame(t, 1000 + FLIP_MS * 0.3);
    expect(vi.mocked(drawArt).mock.calls.map((c) => c[0])).toEqual(['snowflake']);
    expect(drawStarBody).not.toHaveBeenCalled();
    vi.mocked(drawArt).mockClear();
    log = [];
    frame(t, 1000 + FLIP_MS * 0.7);
    expect(drawArt).not.toHaveBeenCalled();
    expect(calls('drawImage')).toHaveLength(2); // the head's dim and lit stickers
  });

  it('the burst and the wobble run for every kind', async () => {
    for (const kind of KINDS) {
      const t = new Topper();
      t.setKind(kind);
      await t.load();
      t.flip(true, 1000);
      for (const at of [1000, 1000 + FLIP_MS / 2, 1000 + FLIP_MS - 1]) {
        expect(t.busy(at), kind).toBe(true);
        expect(t.needsFrame(at), kind).toBe(true);
      }
      log = [];
      frame(t, 1000 + FLIP_MS / 2 + 200);
      expect(calls('fillRect').length, kind).toBeGreaterThan(20);
      t.flip(false, 5000);
      t.tap(10_000, 3);
      log = [];
      frame(t, 10_000 + WOBBLE_MS * 0.2);
      expect(calls('rotate').some((c) => Math.abs(c.args[0] as number) > 0.01), kind).toBe(true);
    }
  });

  it('sprites are built at prepare, never during a frame, on a desktop and on a touch screen', () => {
    const L2 = computeLayout(1100, 760, 2);
    const make = vi.spyOn(document, 'createElement');
    const canvases = () => make.mock.calls.filter((c) => c[0] === 'canvas').length;
    for (const touch of [false, true]) {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: touch, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
      for (const kind of ['snowflake', 'angel', 'bow'] as const) {
        const t = new Topper();
        t.setKind(kind);
        t.prepare(L2, SCENES.frost);
        const built = canvases();
        expect(built, `${kind} touch=${touch}`).toBeGreaterThan(0);
        t.draw(recorder(log), L2, SCENES.frost, { glow: 1, on: 1 }, true, 1, 5000, 4000, false, 2);
        t.drawGlow(recorder(log), L2, SCENES.frost, { glow: 1, on: 1 }, true, 1, 5000, 4000, false, 1);
        expect(canvases(), `${kind} touch=${touch}`).toBe(built);
        make.mockClear();
      }
    }
  });
});
