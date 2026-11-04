// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CAPTION_DELAY_MS, CAPTION_FADE_MS, CLEAR_MS, FERNS_MS, FROST_IN_MS, FrostPause } from '../../../src/ui/frost-pause';

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no canvas 2D context: every call on this one does nothing.
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 100 }) : k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }) : () => (String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
    set: (t, k, v) => ((t[k] = v), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  document.body.innerHTML = '<canvas id="stage" width="400" height="300"></canvas><div id="pause" hidden></div>';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const host = () => document.getElementById('pause') as HTMLElement;

it('the timings are the spec ones', () => {
  expect([FROST_IN_MS, FERNS_MS, CAPTION_DELAY_MS, CAPTION_FADE_MS, CLEAR_MS]).toEqual([160, 200, 200, 200, 150]);
});

it('show() opens the glass and adds .show; the host is shown', () => {
  const f = new FrostPause(host());
  expect(f.open).toBe(false);
  f.show(false);
  expect(f.open).toBe(true);
  expect(host().classList.contains('show')).toBe(true);
  expect(host().hidden).toBe(false);
});

it('hide() clears the glass and removes .show after CLEAR_MS', () => {
  const f = new FrostPause(host());
  f.show(false);
  f.hide();
  expect(f.open).toBe(false);
  vi.advanceTimersByTime(CLEAR_MS - 1);
  expect(host().classList.contains('show') || host().classList.contains('melt')).toBe(true);
  expect(host().hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(host().classList.contains('show')).toBe(false);
  expect(host().classList.contains('melt')).toBe(false);
  expect(host().hidden).toBe(true);
});

it('showing again during the clear-away keeps the glass', () => {
  const f = new FrostPause(host());
  f.show(false);
  f.hide();
  vi.advanceTimersByTime(CLEAR_MS / 2);
  f.show(false);
  vi.advanceTimersByTime(CLEAR_MS * 2);
  expect(f.open).toBe(true);
  expect(host().hidden).toBe(false);
  expect(host().classList.contains('show')).toBe(true);
  expect(host().classList.contains('melt')).toBe(false);
});

it('reduced motion: the frost is fully formed at once, with no animation', () => {
  const f = new FrostPause(host());
  f.show(true);
  expect(host().classList.contains('reduced')).toBe(true);
  expect(host().classList.contains('show')).toBe(true);
  f.hide();
  vi.advanceTimersByTime(CLEAR_MS);
  f.show(false);
  expect(host().classList.contains('reduced')).toBe(false);
});

it('hide() without show() does nothing', () => {
  const f = new FrostPause(host());
  f.hide();
  expect(host().hidden).toBe(true);
});

it('a wipe drag does not count as a click that resumes', () => {
  const f = new FrostPause(host());
  f.show(false);
  let clicks = 0;
  host().addEventListener('click', () => clicks++);
  const ev = (type: string, x: number, y: number) => host().dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, pointerId: 1 }));
  host().setPointerCapture = () => undefined;
  ev('pointerdown', 10, 10);
  ev('pointermove', 80, 80);
  ev('pointerup', 80, 80);
  host().dispatchEvent(new Event('click', { bubbles: true }));
  expect(clicks).toBe(0);
  // A plain tap still clicks through.
  ev('pointerdown', 10, 10);
  ev('pointerup', 10, 10);
  host().dispatchEvent(new Event('click', { bubbles: true }));
  expect(clicks).toBe(1);
});
