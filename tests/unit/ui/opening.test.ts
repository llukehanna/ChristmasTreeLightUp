// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindInput, type InputHandlers } from '../../../src/input';
import { IDENTITY } from '../../../src/render/camera';
import { garlandGeometry } from '../../../src/render/garland';
import { computeLayout } from '../../../src/render/layout';
import { SCENES } from '../../../src/render/scenes';
import { OPENING_MS, Opening, shouldOpen } from '../../../src/ui/opening';

let reduced = false;
/** drawImage calls on the stage's context (the opening draws nothing else that shows). */
let drawn = 0;

/** jsdom has no canvas 2D context: every call on this one does nothing (drawImage is counted on the stage's). */
function context(count: boolean): CanvasRenderingContext2D {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) =>
      k in t
        ? t[k]
        : k === 'drawImage'
          ? () => void (count && drawn++)
          : () => (String(k).startsWith('create') ? { addColorStop() {} } : undefined),
    set: (t, k, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  reduced = false;
  drawn = 0;
  localStorage.clear();
  sessionStorage.clear();
  document.body.className = '';
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') && reduced, media: q }));
  const offscreen = context(false);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => offscreen) as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const L = computeLayout(1280, 800, 2);
const opening = (): Opening => {
  const geo = garlandGeometry(L.w, L.s, 58);
  return new Opening({ garland: () => geo, bulbs: () => SCENES.fireside.bulbs, camera: () => IDENTITY });
};
const body = (c: string): boolean => document.body.classList.contains(c);
/** jsdom has no PointerEvent: a MouseEvent with the pointer's type and id on top. */
function pointer(type: string, pointerType: string, pointerId: number): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 6 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  return e;
}

it('plays on a first visit only', () => {
  expect(shouldOpen()).toBe(true);
  localStorage.setItem('aglow.opened', 'true');
  expect(shouldOpen()).toBe(false);
});

it('not on a device with play data (the look alone, which a first load writes, is none)', () => {
  for (const key of ['aglow.stats', 'aglow.game', 'aglow.settings', 'aglow.radio']) {
    localStorage.clear();
    localStorage.setItem(key, '{}');
    expect(shouldOpen(), key).toBe(false);
  }
  // Back from Google ("Save to leaderboard"): the return marker is in sessionStorage.
  localStorage.clear();
  sessionStorage.setItem('aglow.return', 'g1');
  expect(shouldOpen()).toBe(false);
  sessionStorage.clear();
  localStorage.setItem('aglow.return', 'g1');
  expect(shouldOpen()).toBe(true);
  localStorage.clear();
  localStorage.setItem('aglow.look', '{}');
  expect(shouldOpen()).toBe(true);
});

it('not under reduced motion or a saved egg world', () => {
  reduced = true;
  expect(shouldOpen()).toBe(false);
  reduced = false;
  localStorage.setItem('aglow.starHead', 'true');
  expect(shouldOpen()).toBe(false);
  localStorage.clear();
  localStorage.setItem('aglow.homeAlone', 'true');
  expect(shouldOpen()).toBe(false);
});

it("the lab's timeline: the wordmark at 1.95 s, the tagline at 2.3 s, the HUD at 2.75 s, chrome off at 4.6 s", () => {
  const o = opening();
  o.play(performance.now());
  expect(o.on).toBe(true);
  expect(body('m-open')).toBe(true);
  vi.advanceTimersByTime(1949);
  expect(body('m-o-mark')).toBe(false);
  vi.advanceTimersByTime(1);
  expect(body('m-o-mark')).toBe(true);
  expect(body('m-o-tag')).toBe(false);
  vi.advanceTimersByTime(350);
  expect(body('m-o-tag')).toBe(true);
  expect(body('m-o-hud')).toBe(false);
  vi.advanceTimersByTime(450);
  expect(body('m-o-hud')).toBe(true);
  vi.advanceTimersByTime(OPENING_MS - 2750 - 1);
  expect(o.on).toBe(true);
  vi.advanceTimersByTime(1);
  expect(o.on).toBe(false);
  for (const c of ['m-open', 'm-o-mark', 'm-o-tag', 'm-o-hud']) expect(body(c)).toBe(false);
});

it('a key or click skips: faded by 650 ms, off at 900 ms', () => {
  const c = context(true);
  for (const input of ['keydown', 'pointerdown'] as const) {
    const o = opening();
    const stage = document.createElement('canvas');
    document.body.append(stage);
    const game = vi.fn();
    document.addEventListener('keydown', game);
    stage.addEventListener('pointerdown', game);
    o.play(performance.now());
    vi.advanceTimersByTime(1200);
    drawn = 0;
    o.front(c, L, performance.now());
    expect(drawn).toBeGreaterThan(0);

    // The first key or press anywhere skips, and never reaches the game (no tile turns, no N, P, Escape or Tab).
    const e = input === 'keydown' ? new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }) : new Event('pointerdown', { bubbles: true, cancelable: true });
    (input === 'keydown' ? document.body : stage).dispatchEvent(e);
    expect(game).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    expect(body('m-o-fast') && body('m-o-mark') && body('m-o-tag') && body('m-o-hud')).toBe(true);
    const skipAt = performance.now();
    drawn = 0;
    o.front(c, L, skipAt + 400);
    expect(drawn).toBeGreaterThan(0);
    drawn = 0;
    o.front(c, L, skipAt + 650);
    expect(drawn).toBe(0);

    vi.advanceTimersByTime(899);
    expect(o.on).toBe(true);
    vi.advanceTimersByTime(1);
    expect(o.on).toBe(false);
    expect(body('m-open')).toBe(false);
    // Over: input reaches the game again.
    (input === 'keydown' ? document.body : stage).dispatchEvent(new KeyboardEvent(input, { bubbles: true }));
    expect(game).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', game);
    stage.remove();
    vi.advanceTimersByTime(3000);
  }
});

it('the skip gesture is swallowed whole: a click on a HUD button fires nothing, and after the opening it does', () => {
  const button = document.createElement('button');
  document.body.append(button);
  const fired: string[] = [];
  for (const t of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup']) button.addEventListener(t, () => fired.push(t));
  document.addEventListener('click', () => fired.push('document click'));
  const press = () => {
    for (const t of ['pointerdown', 'pointerup', 'click']) button.dispatchEvent(pointer(t, 'mouse', 1));
  };
  const o = opening();
  o.play(performance.now());
  vi.advanceTimersByTime(500);
  press();
  expect(fired).toEqual([]);
  expect(body('m-o-fast')).toBe(true);
  vi.advanceTimersByTime(900);
  expect(o.on).toBe(false);
  press();
  expect(fired).toEqual(['pointerdown', 'pointerup', 'click', 'document click']);

  // A key: its keyup (a Space on a focused button clicks on keyup) is swallowed too; another key's is not.
  fired.length = 0;
  o.play(performance.now());
  const key = (type: string, code: string) => button.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : 'a', bubbles: true, cancelable: true }));
  key('keydown', 'Space');
  key('keyup', 'KeyA');
  key('keyup', 'Space');
  expect(fired).toEqual(['keyup']);
  vi.advanceTimersByTime(900);
  key('keydown', 'Space');
  key('keyup', 'Space');
  expect(fired).toEqual(['keyup', 'keydown', 'keyup']);
  button.remove();
});

it('a hidden tab ends it at once (no replay on return)', () => {
  const o = opening();
  o.play(performance.now());
  vi.advanceTimersByTime(1000);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(o.on).toBe(false);
  expect(body('m-open')).toBe(false);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(o.on).toBe(false);
});

it("a skip swallows only its own pointer: another finger's tap during the tail reaches the stage, and touch stays sane", () => {
  const stage = document.createElement('div');
  document.body.append(stage);
  const h = { tap: vi.fn(), hover: vi.fn(), leave: vi.fn(), zoom: vi.fn(), pan: vi.fn() };
  const unbind = bindInput(stage, h as unknown as InputHandlers);
  const o = opening();
  o.play(performance.now());
  vi.advanceTimersByTime(500);
  // Two fingers: the first skips (and is still down), the second taps a tile during the fade.
  stage.dispatchEvent(pointer('pointerdown', 'touch', 1));
  stage.dispatchEvent(pointer('pointerdown', 'touch', 2));
  stage.dispatchEvent(pointer('pointerup', 'touch', 2));
  expect(h.tap).toHaveBeenCalledTimes(1);
  // The skipping finger lifts: swallowed (the stage never had it).
  stage.dispatchEvent(pointer('pointerup', 'touch', 1));
  expect(h.tap).toHaveBeenCalledTimes(1);
  // The stage's bookkeeping is empty again: a later tap is a tap, not half a pinch.
  stage.dispatchEvent(pointer('pointerdown', 'touch', 3));
  stage.dispatchEvent(pointer('pointerup', 'touch', 3));
  expect(h.tap).toHaveBeenCalledTimes(2);
  expect(h.zoom).not.toHaveBeenCalled();
  unbind();
  stage.remove();
  vi.advanceTimersByTime(3000);
});

it('the room is lit (the first tree may start) at the HUD mark, at once on a skip, or when it ends', async () => {
  const settled = (p: Promise<void>) => {
    let done = false;
    void p.then(() => (done = true));
    return async () => {
      await Promise.resolve();
      await Promise.resolve();
      return done;
    };
  };
  const o = opening();
  expect(await settled(o.roomLit())()).toBe(true);
  o.play(performance.now());
  let lit = settled(o.roomLit());
  vi.advanceTimersByTime(2749);
  expect(await lit()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(await lit()).toBe(true);
  vi.advanceTimersByTime(3000);

  o.play(performance.now());
  lit = settled(o.roomLit());
  vi.advanceTimersByTime(300);
  expect(await lit()).toBe(false);
  o.skip(performance.now());
  expect(await lit()).toBe(true);
  vi.advanceTimersByTime(3000);

  o.play(performance.now());
  lit = settled(o.roomLit());
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  expect(await lit()).toBe(true);
});
