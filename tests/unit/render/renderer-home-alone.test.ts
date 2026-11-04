// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Board } from '../../../src/core/board';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { Aurora, FADE_MS } from '../../../src/render/aurora';
import { IDENTITY } from '../../../src/render/camera';
import { CONFETTI_MS, Snowfall } from '../../../src/render/effects';
import { PizzaSprite } from '../../../src/render/pizza';
import { EGGS } from '../../../src/eggs/eggs';
import { Renderer, type FrameInput } from '../../../src/render/renderer';
import { AURORA, HOME_ALONE, SCENES, type Scene } from '../../../src/render/scenes';
import { VisualState } from '../../../src/render/visual-state';

/** Every gradient colour stop drawn, in order (the firelight's strength is in its first stop). */
let stops: string[] = [];
/** A 2D context that accepts everything. */
function sink(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  // save() and restore() keep the alpha and the blend, as a real context does.
  const saved: [unknown, unknown][] = [];
  state.save = () => void saved.push([state.globalAlpha, state.globalCompositeOperation]);
  state.restore = () => {
    const top = saved.pop();
    if (top) [state.globalAlpha, state.globalCompositeOperation] = top;
  };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (_x?: number, _y?: number, w = 1, h = 1) => {
        if (k === 'getImageData' || k === 'createImageData') return { data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h };
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop: (_o: number, c: string) => stops.push(c), setTransform() {} };
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
  stops = [];
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
  r.attachEggs(EGGS); // the eggs have loaded (src/eggs/load.ts)
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

it('before the eggs load the egg layers are null and every frame draws without them; attaching them repaints the room', () => {
  const r = new Renderer(document.createElement('canvas'));
  expect([r.homeAlone, r.faces]).toEqual([null, null]);
  r.resize(1280, 800, 2);
  const solved = Board.random(GRID, mulberry32(7));
  const board = new Board(GRID, { solution: [...solved.solution], bits: [...solved.solution], colors: [...solved.colors] });
  const vis = new VisualState(GRID.cells.length);
  vis.onLightingChanged(board, board.lighting.order, [], 0, false);
  const f = (now: number, over: Partial<FrameInput> = {}): FrameInput => ({
    board, vis, now, dt: 16, camera: IDENTITY, hover: -1, revealAt: -100_000, winAt: null, reducedMotion: false, ...over,
  });
  // Every scene, a win's confetti and a beat: nothing reaches for an egg that isn't there.
  for (const sc of [...Object.values(SCENES), AURORA, HOME_ALONE]) {
    r.setScene(sc);
    expect(() => r.frame(f(3000, { winAt: 1000, beat: { at: 2900, strength: 1, hue: 1 } }))).not.toThrow();
  }
  expect(r.faceInfo()).toEqual({ tile: -1, gift: -1, garland: -1 });
  const draw = vi.spyOn(Aurora.prototype, 'draw');
  const window = vi.spyOn(EGGS.homeAlone.HomeAloneLayer.prototype, 'drawWindow');
  const room = vi.spyOn(EGGS.homeAloneRoom, 'paintHomeAlone');
  r.attachEggs(EGGS);
  expect(r.homeAlone).not.toBeNull();
  expect(r.faces).not.toBeNull();
  expect(room).toHaveBeenCalledTimes(1); // the house was up already: its room is painted now
  r.frame(f(4000));
  expect(window).toHaveBeenCalledTimes(1);
  r.setScene(AURORA);
  r.frame(f(4016));
  expect(draw).toHaveBeenCalledTimes(1);
});

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
  const draw = vi.spyOn(r.homeAlone!, 'drawWindow');
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

it('switched off, the house fades out with a walk still under way; it ends once the house has gone', () => {
  const { r, frame } = setup(HOME_ALONE);
  r.frame(frame(1000));
  r.homeAlone!.force('bandits', 1000, r.layout);
  r.setScene(SCENES.midnight, { now: 2000, reduced: false, kind: 'fade' });
  expect(r.homeAloneShowing).toBe(true); // the app keeps stepping the layer while this holds
  r.frame(frame(2000 + FADE_MS / 2));
  expect(r.homeAloneShowing).toBe(true);
  expect(r.homeAlone!.state().bandits).toBe(true);
  r.frame(frame(2000 + FADE_MS + 10));
  expect(r.homeAloneShowing).toBe(false);
  expect(r.homeAlone!.state().bandits).toBe(false);
  // Without a fade the house goes at once, and so does the walk.
  const b = setup(HOME_ALONE);
  b.r.homeAlone!.force('bandits', 0, b.r.layout);
  b.r.setScene(SCENES.midnight);
  expect(b.r.homeAloneShowing).toBe(false);
  b.r.frame(b.frame(1000));
  expect(b.r.homeAlone!.state().bandits).toBe(false);
});

it('the traps draw over the board only in the house, and never under reduced motion', () => {
  const { r, frame } = setup(SCENES.midnight);
  const traps = vi.spyOn(r.homeAlone!, 'drawTraps');
  r.frame(frame(1000));
  expect(traps).not.toHaveBeenCalled();
  r.setScene(HOME_ALONE);
  r.frame(frame(1016));
  expect(traps).toHaveBeenCalledTimes(1);
  // Under reduced motion no trap runs, and none is drawn.
  r.frame(frame(1032, { reducedMotion: true }));
  expect(traps).toHaveBeenCalledTimes(1);
});

it('a win in the house asks for the pizza slice only while the confetti falls; other scenes never do', () => {
  const get = vi.spyOn(PizzaSprite.prototype, 'get');
  const night = setup(SCENES.midnight);
  night.r.frame(night.frame(3000, { winAt: 1000 }));
  expect(get).not.toHaveBeenCalled();
  const house = setup(HOME_ALONE);
  house.r.frame(house.frame(3000, { winAt: 1000 }));
  expect(get).toHaveBeenCalledTimes(1);
  house.r.frame(house.frame(1000 + CONFETTI_MS + 10, { winAt: 1000 }));
  expect(get).toHaveBeenCalledTimes(1);
});

/** The firelight's strength this frame: its inner stop's alpha over the full flicker's, or 0 with none drawn. */
function firelight(): number {
  const inner = stops.find((c) => c.startsWith('rgba(255,120,40,') && c !== 'rgba(255,120,40,0)');
  return inner ? Number(/,([\d.e-]+)\)$/.exec(inner)?.[1]) : 0;
}

it('the firelight comes in and goes out with the fade, never popping at the halfway mark', () => {
  const { r, frame } = setup(SCENES.midnight);
  r.frame(frame(500));
  expect(firelight()).toBe(0); // midnight: no hearth
  r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  const at = (k: number, now = 1000 + k * FADE_MS): number => {
    stops = [];
    r.frame(frame(now));
    return firelight();
  };
  // The flicker is 0.2..0.28 at full: scaled by the house's alpha, it rises smoothly from nothing.
  const quarter = at(0.25);
  expect(quarter).toBeGreaterThan(0.2 * 0.25 - 1e-9);
  expect(quarter).toBeLessThanOrEqual(0.28 * 0.25 + 1e-9);
  expect(at(0.45)).toBeLessThanOrEqual(0.28 * 0.45 + 1e-9);
  expect(at(0.55)).toBeLessThanOrEqual(0.28 * 0.55 + 1e-9);
  expect(at(1.1)).toBeGreaterThanOrEqual(0.2);
  // Fireside to the house: a hearth on both sides, so it stays full throughout.
  const f = setup(SCENES.fireside);
  f.r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  stops = [];
  f.r.frame(f.frame(1000 + 0.5 * FADE_MS));
  expect(firelight()).toBeGreaterThanOrEqual(0.2);
});

it("while fading, the leaving scene's snow fades out at 1 − alpha and the arriving one's in at alpha, the flakes moving once", () => {
  const { r, frame } = setup(SCENES.midnight);
  const seen: [string, number, number][] = [];
  vi.spyOn(Snowfall.prototype, 'draw').mockImplementation((c, _L, sc, _front, dt) => void seen.push([sc.id, c.globalAlpha, dt]));
  r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  r.frame(frame(1000 + 0.25 * FADE_MS));
  // Back and front layers: the house (no snow) at 0.25, midnight's snow at 0.75 and moving (the house's draw moves none).
  expect(seen.map(([id, a, dt]) => [id, Number(a.toFixed(3)), dt])).toEqual([
    ['home-alone', 0.25, 16], ['midnight', 0.75, 16], ['home-alone', 0.25, 16], ['midnight', 0.75, 16],
  ]);
  seen.length = 0;
  r.frame(frame(1000 + FADE_MS + 10));
  expect(seen.map(([id, a]) => [id, a])).toEqual([['home-alone', 1], ['home-alone', 1]]);
  // Both sides snowing: the arriving draw moves the flakes, the leaving one only draws them.
  const b = setup(SCENES.frost);
  seen.length = 0;
  b.r.setScene(SCENES.midnight, { now: 1000, reduced: false, kind: 'fade' });
  b.r.frame(b.frame(1000 + 0.5 * FADE_MS));
  expect(seen.map(([id, , dt]) => [id, dt])).toEqual([['midnight', 16], ['frost', 0], ['midnight', 16], ['frost', 0]]);
});

it("leaving the aurora (kevin during the head) its curtains draw under the fade; a fade from another sky draws none", () => {
  const draw = vi.spyOn(Aurora.prototype, 'draw');
  const { r, frame } = setup(AURORA);
  r.frame(frame(500));
  expect(draw).toHaveBeenCalledTimes(1);
  r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  r.frame(frame(1000 + 0.5 * FADE_MS));
  expect(draw).toHaveBeenCalledTimes(2);
  r.frame(frame(1000 + FADE_MS + 10));
  expect(draw).toHaveBeenCalledTimes(2); // the house alone now
  const night = setup(SCENES.midnight);
  draw.mockClear();
  night.r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  night.r.frame(night.frame(1000 + 0.5 * FADE_MS));
  expect(draw).not.toHaveBeenCalled();
});

it('kevin again mid-fade turns the house back from where it stands: the window fades out from its alpha', () => {
  const { r, frame } = setup(SCENES.midnight);
  const win = vi.spyOn(r.homeAlone!, 'drawWindow');
  r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  r.frame(frame(1000 + 0.3 * FADE_MS));
  expect(win.mock.calls.at(-1)?.[2]).toBeCloseTo(0.3);
  r.setScene(SCENES.midnight, { now: 1000 + 0.3 * FADE_MS + 4, reduced: false, kind: 'fade' });
  expect(r.homeAloneShowing).toBe(true);
  r.frame(frame(1000 + 0.3 * FADE_MS + 16));
  expect(win.mock.calls.at(-1)?.[2]).toBeCloseTo(0.3 - 16 / FADE_MS);
  r.frame(frame(1000 + 0.3 * FADE_MS + 0.3 * FADE_MS + 20));
  expect(r.sweeping).toBe(false);
  expect(r.homeAloneShowing).toBe(false);
});

it("the head mid-fade (hohoho): the head's sweep takes over from the sky as it stands, and the window goes with the house", () => {
  const { r, frame } = setup(SCENES.midnight);
  const win = vi.spyOn(r.homeAlone!, 'drawWindow');
  r.setScene(HOME_ALONE, { now: 1000, reduced: false, kind: 'fade' });
  r.frame(frame(1000 + 0.6 * FADE_MS));
  win.mockClear();
  r.setScene(AURORA, { now: 1600, reduced: false, kind: 'sweep' });
  expect(r.sweeping).toBe(true);
  expect(r.homeAloneShowing).toBe(false); // a sweep never shows the window gags: the walk ends with them
  r.frame(frame(1700));
  expect(win).not.toHaveBeenCalled();
  expect(r.homeAlone!.state().bandits).toBe(false);
});
