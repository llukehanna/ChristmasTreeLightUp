// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GLARE_HOLD_MS, GLARE_IN_MS, GLARE_OUT_MS, GLARE_WAIT_MS, HectorGlare } from '../../../src/ui/hector';

/** Every Image the glare makes; jsdom never loads them, so a test settles each one by hand. */
let made: HTMLImageElement[] = [];
const RealImage = window.Image;
const settle = (img: HTMLImageElement, ok: boolean) => {
  Object.defineProperty(img, 'naturalWidth', { value: ok ? 640 : 0 });
  (ok ? img.onload : img.onerror)?.call(img, new Event(ok ? 'load' : 'error'));
};
const tick = () => vi.advanceTimersByTimeAsync(0);

let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  made = [];
  window.Image = class extends RealImage {
    constructor() {
      super();
      made.push(this);
    }
  } as typeof Image;
  host = document.createElement('section');
  document.body.append(host);
});
afterEach(() => {
  window.Image = RealImage;
  host.remove();
  vi.useRealTimers();
});

const frame = () => host.querySelector<HTMLElement>('figure.hector');

it('preloads the still once, from the given url', () => {
  const g = new HectorGlare(() => host, '/effects/home-alone/hector.jpg');
  g.preload();
  g.preload();
  expect(made).toHaveLength(1);
  expect(made[0].getAttribute('src')).toBe('/effects/home-alone/hector.jpg');
});

it('leans in beside the tag, holds about 2.5 s, leans back and is gone', async () => {
  const g = new HectorGlare(() => host, '/h.jpg');
  g.preload();
  settle(made[0], true);
  g.show(false);
  await tick();
  expect(g.showing).toBe(true);
  const f = frame()!;
  expect(f.classList.contains('in')).toBe(true);
  expect(f.classList.contains('still')).toBe(false);
  expect(f.getAttribute('aria-hidden')).toBe('true');
  expect(f.querySelector('img')?.getAttribute('src')).toBe('/h.jpg');
  await vi.advanceTimersByTimeAsync(GLARE_IN_MS + GLARE_HOLD_MS);
  expect(f.classList.contains('in')).toBe(false); // leaning back
  expect(g.showing).toBe(true);
  await vi.advanceTimersByTimeAsync(GLARE_OUT_MS);
  expect(g.showing).toBe(false);
  expect(frame()).toBeNull();
});

it('under reduced motion it fades in place (the still pose)', async () => {
  const g = new HectorGlare(() => host, '/h.jpg');
  g.show(true);
  settle(made[0], true);
  await tick();
  expect(frame()?.className).toBe('hector still in');
});

it('a still that fails, or arrives too late, shows nothing; the next glare tries again', async () => {
  const g = new HectorGlare(() => host, '/h.jpg');
  g.show(false);
  settle(made[0], false);
  await tick();
  expect(g.showing).toBe(false);

  g.show(false);
  expect(made).toHaveLength(2); // fetched again
  await vi.advanceTimersByTimeAsync(GLARE_WAIT_MS);
  settle(made[1], true);
  await tick();
  expect(g.showing).toBe(false);
  expect(frame()).toBeNull();
});

it('cancel takes him away at once, and a still arriving afterwards does not bring him back', async () => {
  const g = new HectorGlare(() => host, '/h.jpg');
  g.show(false);
  g.cancel();
  settle(made[0], true);
  await tick();
  expect(g.showing).toBe(false);

  g.show(false);
  await tick();
  expect(g.showing).toBe(true);
  g.cancel();
  expect(frame()).toBeNull();
});
