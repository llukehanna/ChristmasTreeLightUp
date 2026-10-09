// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { Aurora, RIBBONS, SWEEP_FADE_MS, SWEEP_MS, rayNoise, ribbonCount, sweepFrame } from '../../../src/render/aurora';
import { computeLayout } from '../../../src/render/layout';

afterEach(() => vi.restoreAllMocks());

/** A 2D context that logs every call by name (drawImage's arguments too) and keeps plain properties. */
function recorder(names: string[], draws: unknown[][]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        names.push(String(k));
        if (k === 'drawImage') draws.push(args);
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('sweepFrame', () => {
  it('down covers the sky from the top with an eased edge; up uncovers it; nothing moves before it starts', () => {
    expect(sweepFrame(-100, 'down', false)).toEqual({ cover: 0, alpha: 1, edge: 0, done: false });
    expect(sweepFrame(-100, 'up', false).cover).toBe(1);
    const mid = sweepFrame(SWEEP_MS / 2, 'down', false);
    expect(mid.cover).toBeCloseTo(0.5);
    expect(mid.edge).toBeCloseTo(1);
    expect(sweepFrame(SWEEP_MS * 0.25, 'down', false).cover).toBeLessThan(0.25);
    expect(sweepFrame(SWEEP_MS, 'down', false)).toMatchObject({ cover: 1, edge: 0, done: true });
    expect(sweepFrame(SWEEP_MS, 'up', false)).toMatchObject({ cover: 0, done: true });
  });
  it('reduced motion: a 300 ms crossfade over the whole sky, no edge', () => {
    expect(sweepFrame(SWEEP_FADE_MS / 2, 'down', true)).toEqual({ cover: 1, alpha: 0.5, edge: 0, done: false });
    expect(sweepFrame(SWEEP_FADE_MS / 2, 'up', true).alpha).toBe(0.5);
    expect(sweepFrame(SWEEP_FADE_MS, 'up', true)).toMatchObject({ alpha: 0, done: true });
  });
});

describe('Aurora', () => {
  const L = computeLayout(390, 844, 2);
  let made = 0;
  beforeEach(() => {
    made = 0;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') made++;
      return create(tag);
    }) as typeof document.createElement);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([], [])) as never);
  });

  it('draws one quarter-resolution sprite per curtain: 3, then 2 on tier 2, 1 on tier 3', () => {
    expect([0, 1, 2, 3].map(ribbonCount)).toEqual([3, 3, 2, 1]);
    const a = new Aurora();
    for (const [tier, n] of [[0, 3], [1, 3], [2, 2], [3, 1]] as const) {
      const names: string[] = [];
      const draws: unknown[][] = [];
      a.draw(recorder(names, draws), L, 1000 + tier, tier, false);
      expect(draws).toHaveLength(n);
    }
  });

  it('bakes its sprites once per layout and allocates nothing per frame', () => {
    const a = new Aurora();
    a.draw(recorder([], []), L, 0, 0, false);
    expect(made).toBe(RIBBONS.length);
    const names: string[] = [];
    for (let t = 16; t < 2000; t += 16) a.draw(recorder(names, []), L, t, 0, false);
    expect(made).toBe(RIBBONS.length);
    expect(names.filter((n) => n.startsWith('create'))).toEqual([]);
    a.draw(recorder([], []), computeLayout(1440, 900, 2), 0, 0, false);
    expect(made).toBe(RIBBONS.length * 2);
  });

  it('drifts with time; under reduced motion it holds one pose', () => {
    const a = new Aurora();
    const at = (now: number, reduced: boolean) => {
      const draws: unknown[][] = [];
      a.draw(recorder([], draws), L, now, 0, reduced);
      return draws.map((d) => d.slice(1));
    };
    expect(at(5000, false)).not.toEqual(at(20000, false));
    expect(at(5000, true)).toEqual(at(20000, true));
  });

  it('the seam is one drawImage, only while the edge shows', () => {
    const a = new Aurora();
    const draws: unknown[][] = [];
    a.drawSeam(recorder([], draws), L, 100, 0);
    expect(draws).toHaveLength(0);
    a.drawSeam(recorder([], draws), L, 100, 0.5);
    a.drawSeam(recorder([], draws), L, 120, 0.7);
    expect(draws).toHaveLength(2);
    expect(made).toBe(1);
  });
});

describe('the curtain bake', () => {
  it('rayNoise is smooth, deterministic and within 0..1', () => {
    const a = rayNoise(400, 6, mulberry32(5));
    expect([...a]).toEqual([...rayNoise(400, 6, mulberry32(5))]);
    for (let x = 0; x < a.length; x++) {
      expect(a[x]).toBeGreaterThanOrEqual(0);
      expect(a[x]).toBeLessThanOrEqual(1);
      if (x > 0) expect(Math.abs(a[x] - a[x - 1])).toBeLessThan(0.3);
    }
  });

  it('never cuts a ray off at the sprite top: each lifted column starts transparent inside the sprite', () => {
    const L = computeLayout(390, 844, 2);
    const sprites: { h: number; grad: number[]; cols: number[][] }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      const s = { h: this.height, grad: [] as number[], cols: [] as number[][] };
      sprites.push(s);
      const state: Record<string | symbol, unknown> = { globalAlpha: 1 };
      return new Proxy(state, {
        get(t, k) {
          if (k in t) return t[k];
          return (...args: number[]) => {
            if (k === 'createLinearGradient') {
              s.grad = args;
              return { addColorStop() {} };
            }
            if (k === 'setTransform') s.cols.push(args);
            return undefined;
          };
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      });
    } as never);
    new Aurora().draw(recorder([], []), L, 0, 0, false);
    expect(sprites).toHaveLength(RIBBONS.length);
    for (const s of sprites) {
      const [, y0, , y1] = s.grad;
      expect(y1).toBe(s.h);
      const cols = s.cols.slice(0, -1); // the last is the reset to identity
      expect(cols.length).toBeGreaterThan(10);
      for (const [, , , d, , f] of cols) {
        expect(d * y0 + f).toBeGreaterThanOrEqual(-1e-9); // the transparent top, after the fold's lift
        expect(d * y1 + f).toBeLessThanOrEqual(s.h + 1e-9);
      }
    }
  });
});
