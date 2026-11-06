// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SparkCursor } from '../../../src/ui/spark-cursor';

/** What the spark's canvas was asked to draw. */
let drawn: string[] = [];
let media: Record<string, boolean>;
const listeners = new Map<string, Set<() => void>>();

function sink(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {
        drawn.push(String(k));
        if (typeof k === 'string' && k.startsWith('create')) return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const setHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

function move(x: number, y: number, type = 'pointermove'): void {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  document.body.dispatchEvent(e);
}

const canvas = (): HTMLCanvasElement | null => document.querySelector('canvas.spark-cursor');

beforeEach(() => {
  drawn = [];
  media = { '(pointer: fine)': true, '(prefers-reduced-motion: reduce)': false };
  listeners.clear();
  document.body.innerHTML = '';
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => sink()) as never);
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() {
      return media[q] ?? false;
    },
    media: q,
    addEventListener: (_: string, f: () => void) => (listeners.get(q) ?? listeners.set(q, new Set()).get(q)!).add(f),
    removeEventListener: (_: string, f: () => void) => listeners.get(q)?.delete(f),
  }));
  setHidden(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const make = () => new SparkCursor({ overTile: () => false });

it('off, it costs nothing: no canvas, no listeners, and a frame draws nothing', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const s = make();
  s.frame(16);
  move(100, 100);
  s.frame(32);
  expect(canvas()).toBeNull();
  expect(add).not.toHaveBeenCalled();
  expect(drawn).toEqual([]);
  expect(s.running).toBe(false);
});

it('on, it follows the mouse with an ember on its own canvas, and hides the system cursor', () => {
  const s = make();
  s.start();
  expect(s.running).toBe(true);
  expect(canvas()).not.toBeNull();
  expect(document.body.classList.contains('spark-on')).toBe(true);
  move(120, 140);
  s.frame(16);
  expect(drawn).toContain('arc');
  // The canvas takes no pointer events (chrome only: taps reach the board).
  expect(canvas()!.getAttribute('aria-hidden')).toBe('true');
});

it('it stops when the tab is hidden, and comes back when it is seen again', () => {
  const s = make();
  s.start();
  move(120, 140);
  s.frame(16);
  setHidden(true);
  expect(s.running).toBe(false);
  drawn = [];
  move(130, 150);
  s.frame(32);
  s.frame(48);
  expect(drawn.filter((n) => n !== 'clearRect')).toEqual([]);
  setHidden(false);
  expect(s.running).toBe(true);
  move(140, 160);
  s.frame(64);
  expect(drawn).toContain('arc');
});

it('stop() takes it all away', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const s = make();
  s.start();
  s.stop();
  expect(s.running).toBe(false);
  expect(canvas()).toBeNull();
  expect(document.body.classList.contains('spark-on')).toBe(false);
  expect(remove).toHaveBeenCalled();
  drawn = [];
  move(10, 10);
  s.frame(16);
  expect(drawn).toEqual([]);
});

it('under reduced motion, or with no fine pointer, it never runs; it follows a change of the setting', () => {
  media['(prefers-reduced-motion: reduce)'] = true;
  const s = make();
  s.start();
  expect(s.running).toBe(false);
  expect(canvas()).toBeNull();
  media['(prefers-reduced-motion: reduce)'] = false;
  for (const f of listeners.get('(prefers-reduced-motion: reduce)') ?? []) f();
  expect(s.running).toBe(true);
  media['(prefers-reduced-motion: reduce)'] = true;
  for (const f of listeners.get('(prefers-reduced-motion: reduce)') ?? []) f();
  expect(s.running).toBe(false);
  s.stop();

  media['(prefers-reduced-motion: reduce)'] = false;
  media['(pointer: fine)'] = false;
  const t = make();
  t.start();
  expect(t.running).toBe(false);
});

it('it sleeps once the mouse rests and the sparks have burnt out', () => {
  const s = make();
  s.start();
  move(200, 200);
  let now = 0;
  for (; now < 10_000; now += 16) s.frame(now);
  drawn = [];
  s.frame(now + 16);
  s.frame(now + 32);
  expect(drawn).toEqual([]);
  move(220, 210);
  s.frame(now + 48);
  expect(drawn).toContain('arc');
});
