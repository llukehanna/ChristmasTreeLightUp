import { expect, it } from 'vitest';
import { CONFETTI_COUNT, CONFETTI_MS, Confetti } from '../../../src/render/effects';
import { computeLayout } from '../../../src/render/layout';
import { HOME_ALONE, SCENES } from '../../../src/render/scenes';

it('falls only for a few seconds after the win', () => {
  const c = new Confetti();
  expect(c.count(1000, null, 1)).toBe(0);
  expect(c.count(900, 1000, 1)).toBe(0);
  expect(c.count(1000 + CONFETTI_MS / 2, 1000, 1)).toBe(CONFETTI_COUNT);
  expect(c.count(1000 + CONFETTI_MS + 1, 1000, 1)).toBe(0);
});

it('halves with the quality governor like snow', () => {
  const c = new Confetti();
  expect(c.count(2000, 1000, 0.5)).toBe(CONFETTI_COUNT / 2);
});

it('secret mode: every gold fleck falls as a mini head, the snow stays snow', () => {
  const log = (names: string[]) =>
    new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' } as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : (..._: unknown[]) => (names.push(String(k)), k === 'createRadialGradient' ? { addColorStop() {} } : undefined)),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
  const L = computeLayout(1280, 800, 2);
  const c = new Confetti();
  const plain: string[] = [];
  const heads: string[] = [];
  c.draw(log(plain), L, 4000, 1000, 1, SCENES.midnight);
  c.draw(log(heads), L, 4000, 1000, 1, SCENES.midnight, { width: 30, height: 32 } as HTMLCanvasElement);
  const n = (names: string[], k: string) => names.filter((x) => x === k).length;
  // Every radial glow (snow, a fleck's glint) is one gradient plus one fillRect; a gold fleck is one more fillRect.
  const gold = n(plain, 'fillRect') - n(plain, 'createRadialGradient');
  expect(n(plain, 'drawImage')).toBe(0);
  expect(gold).toBeGreaterThan(20);
  expect(n(heads, 'drawImage')).toBe(gold);
  // Only the snow's glows are left: no gold fills and no glints.
  expect(n(heads, 'fillRect')).toBe(n(heads, 'createRadialGradient'));
  expect(n(heads, 'createRadialGradient')).toBeLessThanOrEqual(n(plain, 'createRadialGradient'));
});

it('Home Alone: every gold fleck tumbles down as a pizza slice, same budget and window', () => {
  const log = (names: string[]) =>
    new Proxy({ globalAlpha: 1, globalCompositeOperation: 'source-over' } as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : (..._: unknown[]) => (names.push(String(k)), k === 'createRadialGradient' ? { addColorStop() {} } : undefined)),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
  const L = computeLayout(1280, 800, 2);
  const plain: string[] = [];
  const pizza: string[] = [];
  new Confetti().draw(log(plain), L, 4000, 1000, 1, HOME_ALONE);
  new Confetti().draw(log(pizza), L, 4000, 1000, 1, HOME_ALONE, { width: 26, height: 29 } as HTMLCanvasElement);
  const gold = plain.filter((x) => x === 'fillRect').length - plain.filter((x) => x === 'createRadialGradient').length;
  expect(pizza.filter((x) => x === 'drawImage')).toHaveLength(gold);
  expect(new Confetti().count(1000 + CONFETTI_MS + 1, 1000, 1)).toBe(0);
});
