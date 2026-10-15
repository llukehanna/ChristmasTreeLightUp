// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { PIZZA_PX, PizzaSprite } from '../../../src/render/pizza';

afterEach(() => vi.restoreAllMocks());

/** A 2D context that accepts every call (gradients included) and keeps plain properties. */
const ok = () =>
  new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : () => (String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
    set: (t, k, v) => ((t[k] = v), true),
  });

it('bakes a slice once per size, reused frame after frame', () => {
  const get = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ok()) as never);
  const p = new PizzaSprite();
  const a = p.get(PIZZA_PX * 2);
  expect(a?.height).toBe(PIZZA_PX * 2);
  expect(a?.width).toBeGreaterThan(0);
  expect(p.get(PIZZA_PX * 2)).toBe(a);
  expect(get).toHaveBeenCalledTimes(1);
  expect(p.get(PIZZA_PX)).not.toBe(a); // a new DPR
});

it('no 2D context: no sprite, for good (the gold flecks stay)', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
  const p = new PizzaSprite();
  expect(p.get(58)).toBeNull();
  expect(p.get(58)).toBeNull();
});
