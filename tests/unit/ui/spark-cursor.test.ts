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

/**
 * A mouse event at (x, y). jsdom can't make a trusted event, so the cursor is told which are the user's: all but those
 * marked `remapped` (the drawer's re-sent copies).
 */
function move(x: number, y: number, type = 'pointermove', remapped = false, target: Element = document.body): void {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  if (remapped) Object.defineProperty(e, 'remapped', { value: true });
  target.dispatchEvent(e);
}

const canvas = (): HTMLCanvasElement | null => document.querySelector('canvas.spark-cursor');

beforeEach(() => {
  drawn = [];
  media = { '(pointer: fine)': true, '(prefers-reduced-motion: reduce)': false };
  listeners.clear();
  document.body.innerHTML = '';
  document.body.className = '';
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
  // Every cursor made here is stopped, so none listens on into the next test.
  for (const s of made.splice(0)) s.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const made: SparkCursor[] = [];
const track = (s: SparkCursor): SparkCursor => (made.push(s), s);
const make = () => track(new SparkCursor({ overTile: () => false, trusted: (e) => !(e as Event & { remapped?: boolean }).remapped }));

it('off, it costs nothing: no canvas, only its two inert pointer listeners, and a frame draws nothing', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const s = make();
  s.frame(16);
  move(100, 100);
  move(100, 100, 'pointerdown');
  s.frame(32);
  expect(canvas()).toBeNull();
  expect(add.mock.calls.map((c) => c[0])).toEqual(['pointermove', 'pointerdown']);
  expect(drawn).toEqual([]);
  expect((s as unknown as { ps: unknown[] }).ps).toEqual([]);
  expect(document.body.classList.contains('spark-on')).toBe(false);
  expect(s.running).toBe(false);
});

it('on, it follows the mouse with an ember on its own canvas, and hides the system cursor', () => {
  const s = make();
  s.start();
  expect(s.running).toBe(true);
  expect(canvas()).not.toBeNull();
  move(120, 140);
  s.frame(16);
  expect(document.body.classList.contains('spark-on')).toBe(true);
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

it('the system cursor stays until the ember is drawn: after start, after the tab comes back, after leaving the page or over a text field', () => {
  const on = () => document.body.classList.contains('spark-on');
  const s = make();
  s.start();
  expect(on()).toBe(false);
  move(50, 60);
  expect(on()).toBe(true);
  document.documentElement.dispatchEvent(new Event('pointerleave'));
  expect(on()).toBe(false);
  move(50, 60);
  setHidden(true);
  expect(on()).toBe(false);
  setHidden(false);
  expect(on()).toBe(false);
  const field = document.createElement('input');
  document.body.append(field);
  move(70, 80, 'pointermove', false, field);
  expect(on()).toBe(false);
  move(70, 80);
  expect(on()).toBe(true);
  s.stop();
  expect(on()).toBe(false);
});

it("the drawer's re-sent pointer events (stage coordinates) never move the ember or burst it", () => {
  const s = make();
  const inside = s as unknown as { x: number; y: number; ps: unknown[] };
  s.start();
  move(300, 200);
  s.frame(16);
  const sparks = inside.ps.length;
  move(900, 700, 'pointermove', true);
  move(900, 700, 'pointerdown', true);
  expect([inside.x, inside.y]).toEqual([300, 200]);
  expect(inside.ps.length).toBe(sparks);
  // The real ones still count: a real press bursts at the pointer.
  move(300, 200, 'pointerdown');
  expect(inside.ps.length).toBeGreaterThan(sparks);
});

it('by default only trusted events count (a synthetic one, as jsdom makes, is ignored)', () => {
  const s = track(new SparkCursor({ overTile: () => false }));
  s.start();
  move(120, 140);
  s.frame(16);
  expect(drawn).not.toContain('arc');
  expect(document.body.classList.contains('spark-on')).toBe(false);
  s.stop();
});

it('started while the drawer is open (its remap listener added first), a real move over the stage still moves the ember', () => {
  const stage = document.createElement('canvas');
  stage.id = 'stage';
  document.body.append(stage);
  const s = make();
  // The drawer's remap, as src/ui/decorate.ts adds it on open: window capture; it stops the real event on the stage and
  // re-sends a copy in stage coordinates.
  const remap = (e: Event): void => {
    if ((e as Event & { remapped?: boolean }).remapped || e.target !== stage) return;
    e.stopImmediatePropagation();
    const m = e as MouseEvent;
    move(m.clientX * 2 + 100, m.clientY * 2 + 100, e.type, true, stage);
  };
  for (const t of ['pointermove', 'pointerdown']) addEventListener(t, remap, true);
  try {
    s.start();
    const inside = s as unknown as { x: number; y: number; ps: unknown[] };
    move(300, 200, 'pointermove', false, stage);
    s.frame(16);
    expect([inside.x, inside.y]).toEqual([300, 200]);
    expect(document.body.classList.contains('spark-on')).toBe(true);
    expect(drawn).toContain('arc');
    // A press over the stage bursts at the real pointer too.
    const before = inside.ps.length;
    move(310, 210, 'pointerdown', false, stage);
    expect(inside.ps.length).toBeGreaterThan(before);
    // …and so after a re-attach (the tab hidden and seen again).
    setHidden(true);
    setHidden(false);
    move(320, 220, 'pointermove', false, stage);
    expect([inside.x, inside.y]).toEqual([320, 220]);
  } finally {
    for (const t of ['pointermove', 'pointerdown']) removeEventListener(t, remap, true);
  }
});
