// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CAPTION_DELAY_MS, CAPTION_FADE_MS, CLEAR_MS, FERNS_MS, FROST_IN_MS, FrostPause } from '../../../src/ui/frost-pause';

let drawn = 0;
beforeEach(() => {
  drawn = 0;
  vi.useFakeTimers();
  // jsdom has no canvas 2D context: every call on this one does nothing.
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === 'fillRect' || k === 'drawImage' || k === 'clearRect' ? () => void drawn++ : k === 'measureText' ? () => ({ width: 100 }) : k === 'createImageData' ? () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }) : () => (String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
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

it('a tap whose jitter adds up past 6 px but nets under it still clicks through', () => {
  const f = new FrostPause(host());
  f.show(false);
  let clicks = 0;
  host().addEventListener('click', () => clicks++);
  const ev = (type: string, x: number, y: number) => host().dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, pointerId: 1 }));
  host().setPointerCapture = () => undefined;
  ev('pointerdown', 100, 100);
  for (const [x, y] of [[103, 100], [100, 100], [103, 100], [100, 100], [103, 100], [101, 100]]) ev('pointermove', x, y); // 15 px travelled, never 6 px away
  ev('pointerup', 101, 100);
  host().dispatchEvent(new Event('click', { bubbles: true }));
  expect(clicks).toBe(1);
});

it('show() in a hidden tab draws nothing; it paints once the page is visible', () => {
  let hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  try {
    const f = new FrostPause(host());
    f.show(false);
    vi.advanceTimersByTime(1000);
    expect(f.open).toBe(true);
    expect(host().classList.contains('show')).toBe(true);
    expect(drawn).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(drawn).toBeGreaterThan(0);
    const after = drawn;
    document.dispatchEvent(new Event('visibilitychange')); // only once
    expect(drawn).toBe(after);
  } finally {
    delete (document as unknown as Record<string, unknown>).hidden;
  }
});

it('closing the glass while the tab is hidden leaves nothing to paint later', () => {
  let hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  try {
    const f = new FrostPause(host());
    f.show(false);
    f.hide();
    vi.advanceTimersByTime(CLEAR_MS);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(drawn).toBe(0);
  } finally {
    delete (document as unknown as Record<string, unknown>).hidden;
  }
});
