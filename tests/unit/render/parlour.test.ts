// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paintBackdrop } from '../../../src/render/backdrop';
import { computeLayout } from '../../../src/render/layout';
import { FLICKER_MEAN, ParlourRoom } from '../../../src/render/parlour';
import { SCENES } from '../../../src/render/scenes';
import { FakeMatrix, FakePath, drawn, matrices, recorder, type Call } from './backdrop-recorder';

// A browser without canvas filters: blur.ts takes its downsample fallback.
vi.mock('../../../src/render/blur', async (actual) => {
  const real = await actual<typeof import('../../../src/render/blur')>();
  return { ...real, CANVAS_FILTER: false };
});

const L = computeLayout(1280, 800, 2);
let log: Call[];
let main: CanvasRenderingContext2D;

beforeEach(() => {
  log = [];
  matrices.made = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return recorder(log, this);
  } as never);
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', FakeMatrix);
  main = recorder(log, { width: 2560, height: 1600 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The parlour painted, and its room; the log emptied after the paint. */
function parlour(): ParlourRoom {
  const bd = paintBackdrop(main, L, SCENES.parlour);
  expect(bd).toBeInstanceOf(ParlourRoom);
  log.length = 0;
  return bd as ParlourRoom;
}
/** One frame behind the tree: how many flakes, coal breaths and flames it drew, and whether the clock's hands went on. */
function pass(bd: ParlourRoom, now: number, tier: number): { flakes: number; coals: number; flames: number; hands: number } {
  log.length = 0;
  bd.back(main, now, false, tier);
  const imgs = log.filter((c) => c.name === 'drawImage').map((c) => c.args[0]);
  const { spr, clock } = bd.room;
  return {
    flakes: imgs.filter((i) => i === spr.flake).length,
    coals: imgs.filter((i) => i === spr.coals).length,
    flames: imgs.filter((i) => i === spr.flame).length,
    hands: log.filter((c) => c.name === 'moveTo' && c.args[0] === clock.x && c.args[1] === clock.y).length,
  };
}
/** The clock's two hands this frame, as where each one's tip is from the dial's centre (hour first). */
function hands(bd: ParlourRoom, now: number): [number, number][] {
  log.length = 0;
  bd.back(main, now, false, 0);
  const { x, y } = bd.room.clock;
  const tips: [number, number][] = [];
  log.forEach((c, i) => {
    if (c.name === 'moveTo' && c.args[0] === x && c.args[1] === y && log[i + 1]?.name === 'lineTo') {
      const [tx, ty] = log[i + 1].args as number[];
      tips.push([tx - x, ty - y]);
    }
  });
  return tips;
}

describe('the Parlour', () => {
  it('the snow falls only behind the window, the coals glow in the hearth and the flames stand on their candles', () => {
    const bd = parlour();
    const { win, coals, flames, spr } = bd.room;
    // The hearth is on the left, where the game's firelight and embers come from; the window is on the right.
    expect(coals.x).toBeLessThan(L.ox);
    expect(win.x0).toBeGreaterThan(L.ox);
    bd.back(main, 1000, false, 0);
    const clip = log.findIndex((c) => c.name === 'clip');
    expect(clip).toBeGreaterThan(0);
    expect(log[clip - 1]).toEqual({ name: 'rect', args: [win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0] });
    const end = log.findIndex((c, i) => i > clip && c.name === 'restore');
    const snow = drawn(log.slice(clip, end));
    expect(snow).toHaveLength(34);
    for (const q of snow) {
      expect(q.x + q.w / 2).toBeGreaterThanOrEqual(win.x0);
      expect(q.x + q.w / 2).toBeLessThanOrEqual(win.x1);
      expect(q.y + q.h / 2).toBeGreaterThanOrEqual(win.y0);
      expect(q.y + q.h / 2).toBeLessThanOrEqual(win.y1);
    }
    // Nothing else is drawn inside the window's clip.
    expect(log.slice(clip, end).filter((c) => c.name === 'drawImage').every((c) => c.args[0] === spr.flake)).toBe(true);
    // The coals' breath over the firebox, and each flame from its own wick (two candlesticks and the sconce).
    const coal = log.find((c) => c.name === 'drawImage' && c.args[0] === spr.coals)!;
    const [cx, cy, cw, ch] = coal.args.slice(1) as number[];
    expect(cx + cw / 2).toBeCloseTo(coals.x);
    expect(cy + ch / 2).toBeCloseTo(coals.y);
    expect(flames).toHaveLength(3);
    expect(log.filter((c) => c.name === 'translate').map((c) => c.args)).toEqual(flames.map((f) => [f.x, f.y]));
  });

  it('tier 2 halves the window snow, tier 3 lets the coals rest; the flames and the clock go on at every tier', () => {
    const bd = parlour();
    expect(pass(bd, 1000, 0)).toEqual({ flakes: 34, coals: 1, flames: 3, hands: 2 });
    expect(pass(bd, 1016, 1)).toEqual({ flakes: 34, coals: 1, flames: 3, hands: 2 });
    expect(pass(bd, 1032, 2)).toEqual({ flakes: 17, coals: 1, flames: 3, hands: 2 });
    expect(pass(bd, 1048, 3)).toEqual({ flakes: 17, coals: 0, flames: 3, hands: 2 });
  });

  it('reduced motion freezes the snow and the flames, and steadies the glow', () => {
    const bd = parlour();
    const frame = (now: number, reduced: boolean) => {
      log.length = 0;
      bd.back(main, now, reduced, 0);
      const back = drawn(log);
      log.length = 0;
      bd.glow(main, now, reduced);
      return { back, glow: drawn(log) };
    };
    const a = frame(1000, true);
    expect(frame(1500, true)).toEqual(a);
    // Without it the same half second moves the snow and the flames, and the candles' glow flickers.
    const b = frame(1532, false);
    const c = frame(1564, false);
    expect(c.back).not.toEqual(b.back);
    expect(c.glow.map((q) => q.a)).not.toEqual(b.glow.map((q) => q.a));
  });

  it("with motion reduced the candles and coals glow at their flicker's mean, not its peak", () => {
    const bd = parlour();
    const glow = (now: number, reduced: boolean) => {
      log.length = 0;
      bd.glow(main, now, reduced);
      return drawn(log).map((q) => q.a);
    };
    // Three candle blooms, then the coals' (drawn at 0.35 of the flicker).
    expect(glow(1000, true)).toEqual([FLICKER_MEAN, FLICKER_MEAN, FLICKER_MEAN, 0.35 * FLICKER_MEAN]);
    // It really is the mean: the flickering blooms, sampled over a long stretch, average it and swing over 0.64..1.
    const sums = [0, 0, 0, 0];
    let lo = Infinity;
    let hi = -Infinity;
    const n = 20000;
    for (let k = 0; k < n; k++) {
      const a = glow(k * 37.3, false);
      a.forEach((v, i) => (sums[i] += v));
      for (const v of a.slice(0, 3)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    for (const s of sums.slice(0, 3)) expect(s / n).toBeCloseTo(FLICKER_MEAN, 2);
    expect(sums[3] / n).toBeCloseTo(0.35 * FLICKER_MEAN, 2);
    expect(lo).toBeGreaterThanOrEqual(0.64 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('the clock keeps the real time, read at most once a second', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 11, 24, 3, 0, 0));
    const bd = parlour();
    const r = bd.room.clock.r;
    const [h, m] = hands(bd, 1000);
    // Three o'clock: the hour hand points right, the minute hand straight up.
    expect(h[0]).toBeCloseTo(r * 0.45);
    expect(h[1]).toBeCloseTo(0);
    expect(m[0]).toBeCloseTo(0);
    expect(m[1]).toBeCloseTo(-r * 0.7);
    // Within the second the hands aren't read again; after it they are (half past nine: the minute hand straight down).
    vi.setSystemTime(new Date(2026, 11, 24, 9, 30, 0));
    expect(hands(bd, 1500)).toEqual([h, m]);
    const [h2, m2] = hands(bd, 2100);
    expect(m2[0]).toBeCloseTo(0);
    expect(m2[1]).toBeCloseTo(r * 0.7);
    expect(h2[0]).toBeLessThan(0);
  });

  it('no gradient, filter or matrix is created per frame', () => {
    const bd = parlour();
    const create = vi.spyOn(document, 'createElement');
    for (let k = 0; k < 10; k++) {
      bd.back(main, 1000 + k * 120, false, 0);
      bd.glow(main, 1000 + k * 120, false);
    }
    expect(log.filter((c) => c.name === 'createRadialGradient' || c.name === 'createLinearGradient')).toEqual([]);
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    expect(matrices.made).toBe(0);
    // The flake, flame, coal and bloom sprites are baked at paint: no canvas is made per frame either.
    expect(create).not.toHaveBeenCalled();
    // The candles' and the coals' blooms are drawn, and the alpha and composite are put back.
    expect(log.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(40);
    expect(main.globalAlpha).toBe(1);
    expect(main.globalCompositeOperation).toBe('source-over');
  });

  it('without canvas filters the parlour still paints', () => {
    paintBackdrop(main, L, SCENES.parlour);
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    expect(log.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(50);
    // The blurred layers (the damask, the mirror, the greenery, the street outside, the room's light) are composited
    // by the fallback instead.
    expect(log.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(4);
  });
});
