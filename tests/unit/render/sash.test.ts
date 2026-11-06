// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paintBackdrop } from '../../../src/render/backdrop';
import { computeLayout } from '../../../src/render/layout';
import { AURORA, HOME_ALONE, SCENES } from '../../../src/render/scenes';
import { Snowfall } from '../../../src/render/window-kit';
import { FakeMatrix, FakePath, matrices, recorder, type Call } from './backdrop-recorder';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The Sash's room painted, and its snow; the log emptied after the paint. */
function sash(): Snowfall {
  const bd = paintBackdrop(main, L, SCENES.sash);
  expect(bd).toBeInstanceOf(Snowfall);
  log.length = 0;
  return bd as Snowfall;
}
const names = (): string[] => log.map((c) => c.name);
const draws = (): unknown[][] => log.filter((c) => c.name === 'drawImage').map((c) => c.args.slice(1));
/** The flakes drawn before the warm pass, and whether the warm pass ran. */
function pass(bd: Snowfall, tier: number, now: number): { flakes: number; warm: boolean } {
  log.length = 0;
  bd.back(main, now, false, tier);
  const at = log.findIndex((c) => c.name === 'set:globalCompositeOperation' && c.args[0] === 'lighter');
  const before = at < 0 ? log : log.slice(0, at);
  return { flakes: before.filter((c) => c.name === 'drawImage').length, warm: at >= 0 };
}

describe('the Sash', () => {
  it('every other scene paints its own background: no backdrop, nothing drawn', () => {
    for (const sc of [SCENES.midnight, SCENES.fireside, SCENES.frost, AURORA, HOME_ALONE]) expect(paintBackdrop(main, L, sc)).toBeNull();
    expect(log).toEqual([]);
  });

  it('the snow falls only behind the glass', () => {
    const bd = sash();
    bd.back(main, 1000, false, 0);
    const clip = log.findIndex((c) => c.name === 'clip');
    expect(clip).toBeGreaterThanOrEqual(0);
    expect(log[clip].args[0]).toBe(bd.spec.glass);
    expect(bd.spec.glass).toBeInstanceOf(FakePath);
    const first = names().indexOf('drawImage');
    expect(first).toBeGreaterThan(clip);
    // …and the clip is let go once the snow is down.
    expect(names().lastIndexOf('restore')).toBeGreaterThan(names().lastIndexOf('drawImage'));
  });

  it('tier 2 halves the flakes, tier 3 skips the lamp pass', () => {
    const bd = sash();
    // 90 soft flakes and 22 big blurred ones; half of each (rounded up) from tier 2.
    expect(pass(bd, 0, 1000)).toEqual({ flakes: 112, warm: true });
    expect(pass(bd, 1, 1016)).toEqual({ flakes: 112, warm: true });
    expect(pass(bd, 2, 1032)).toEqual({ flakes: 56, warm: true });
    expect(pass(bd, 3, 1048)).toEqual({ flakes: 56, warm: false });
    // The two sheets of far snow fall at every tier.
    expect(log.filter((c) => c.name === 'pattern')).toHaveLength(2);
  });

  it('reduced motion freezes the flakes', () => {
    const bd = sash();
    bd.back(main, 1000, true, 0);
    const a = log.filter((c) => c.name === 'drawImage' || c.name === 'pattern').map((c) => c.args.slice(1));
    log.length = 0;
    bd.back(main, 1500, true, 0);
    const b = log.filter((c) => c.name === 'drawImage' || c.name === 'pattern').map((c) => c.args.slice(1));
    expect(b).toEqual(a);
    // Without it the same half second moves them.
    log.length = 0;
    bd.back(main, 1532, false, 0);
    const moving = draws();
    log.length = 0;
    bd.back(main, 1564, false, 0);
    expect(draws()).not.toEqual(moving);
  });

  it('no gradient, filter or matrix is created per frame', () => {
    const bd = sash();
    matrices.made = 0;
    const create = vi.spyOn(document, 'createElement');
    for (let k = 0; k < 10; k++) {
      bd.back(main, 1000 + k * 16, false, 0);
      bd.glow(main);
    }
    expect(log.filter((c) => c.name === 'createRadialGradient' || c.name === 'createLinearGradient')).toEqual([]);
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    expect(matrices.made).toBeLessThanOrEqual(1);
    // The flake and glow sprites are the snow's own: no canvas is made per frame either.
    expect(create).not.toHaveBeenCalled();
    // The lamp's glow is drawn, and the alpha put back.
    expect(log.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(0);
    expect(main.globalAlpha).toBe(1);
  });

  it('without canvas filters the room still paints', () => {
    paintBackdrop(main, L, SCENES.sash);
    expect(log.filter((c) => c.name === 'set:filter')).toEqual([]);
    expect(log.filter((c) => c.name === 'fillRect').length).toBeGreaterThan(20);
    // The blurred layers (the far ridge, the window's spill) are composited by the fallback instead.
    expect(log.filter((c) => c.name === 'drawImage').length).toBeGreaterThan(1);
  });
});
