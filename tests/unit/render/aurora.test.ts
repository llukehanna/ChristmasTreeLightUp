// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import {
  Aurora, RIBBONS, SEAM_AMP, SEAM_CORE_ROW, SEAM_H, SEAM_P, SWEEP_FADE_MS, SWEEP_MS, SkySweep, rayNoise, ribbonCount,
  seamWave, sweepFrame,
} from '../../../src/render/aurora';
import { computeLayout } from '../../../src/render/layout';
import { AURORA, SCENES } from '../../../src/render/scenes';

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

  it('the seam covers the viewport, its glow at most 5 % of the height, and the clip edge rides its core', () => {
    const a = new Aurora();
    for (const L2 of [L, computeLayout(1440, 900, 1)]) {
      for (const now of [0, 900, 1800, 2700]) {
        const draws: unknown[][] = [];
        a.drawSeam(recorder([], draws), L2, 300, 1, now);
        const [, x, y, w, h] = draws[0] as number[];
        expect(x).toBeLessThan(-0.02 * L2.w);
        expect(x + w).toBeGreaterThan(1.02 * L2.w);
        const hh = (h * SEAM_P) / SEAM_H;
        expect(hh).toBeCloseTo(Math.min(1.6 * L2.s, 0.05 * L2.h));
        // The clip's edge, point by point, is the seam's core row on screen.
        const pts: number[][] = [];
        const c = recorder([], []);
        (c as unknown as Record<string, unknown>).lineTo = (px: number, py: number) => pts.push([px, py]);
        a.clipSky(c, L2, 300, 1, now);
        const edge = pts.slice(1);
        expect(edge.length).toBeGreaterThan(16);
        expect(Math.min(...edge.map((p) => p[0]))).toBe(0);
        expect(Math.max(...edge.map((p) => p[0]))).toBe(L2.w);
        for (const [px, py] of edge) {
          const u = (px - x) / w;
          expect(py).toBeCloseTo(y + (h * (SEAM_CORE_ROW + SEAM_AMP * seamWave(u))) / SEAM_H, 6);
          expect(Math.abs(py - 300)).toBeLessThanOrEqual((SEAM_AMP / SEAM_P) * hh + 1e-9);
        }
      }
    }
  });

  it('the clip is a plain rectangle while the edge is dark (the reduced-motion crossfade)', () => {
    const names: string[] = [];
    new Aurora().clipSky(recorder(names, []), L, 300, 0, 0);
    expect(names).toEqual(['beginPath', 'rect', 'clip']);
  });
});

describe('SkySweep', () => {
  const at = { now: 1000, reduced: false };
  let made = 0;
  beforeEach(() => {
    made = 0;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') made++;
      return create(tag);
    }) as typeof document.createElement);
  });
  const sized = (s: SkySweep) => {
    s.bg.width = 80;
    s.bg.height = 60;
    return s;
  };

  it('sweeps only when asked, on a sized stage, into or out of the aurora', () => {
    const s = sized(new SkySweep());
    s.change(SCENES.midnight, SCENES.fireside, at, true);
    expect(s.current).toBeNull();
    s.change(SCENES.midnight, AURORA, null, true);
    expect(s.current).toBeNull();
    s.change(SCENES.midnight, AURORA, at, false);
    expect(s.current).toBeNull();
    s.change(SCENES.midnight, AURORA, at, true);
    expect(s.current).toMatchObject({ dir: 'down', fromScene: SCENES.midnight, at: 1000 });
  });

  it('runs, then ends after SWEEP_MS, emptying the canvas it left; the next sweep reuses it', () => {
    const s = sized(new SkySweep());
    const first = s.bg;
    s.change(SCENES.midnight, AURORA, at, true);
    expect(s.bg).not.toBe(first);
    expect([s.bg.width, s.bg.height]).toEqual([80, 60]);
    expect(s.current?.from).toBe(first);
    expect(s.frame(1000 + SWEEP_MS / 2)?.cover).toBeCloseTo(0.5);
    expect(s.frame(1000 + SWEEP_MS)).toBeNull();
    expect(s.current).toBeNull();
    expect([first.width, first.height]).toEqual([0, 0]);
    const n = made;
    s.change(AURORA, SCENES.midnight, { now: 5000, reduced: false }, true);
    expect(made).toBe(n); // the spare, not a new canvas
    expect(s.bg).toBe(first);
    expect(s.current).toMatchObject({ dir: 'up', fromScene: AURORA });
  });

  it('a resize (end) or a scene change that does not cross ends it at once', () => {
    const s = sized(new SkySweep());
    s.change(SCENES.midnight, AURORA, at, true);
    s.end();
    expect(s.current).toBeNull();
    s.change(AURORA, SCENES.frost, at, true);
    s.change(SCENES.frost, SCENES.fireside, at, true);
    expect(s.current).toBeNull();
  });

  it('a second toggle mid-sweep reverses from where it stands, with no new canvas', () => {
    const s = sized(new SkySweep());
    const first = s.bg;
    s.change(SCENES.midnight, AURORA, at, true);
    const aurora = s.bg;
    const mid = s.frame(1000 + 0.3 * SWEEP_MS)?.cover ?? NaN;
    const n = made;
    s.change(AURORA, SCENES.midnight, { now: 1000 + 0.3 * SWEEP_MS + 325, reduced: false }, true);
    expect(made).toBe(n);
    expect(s.bg).toBe(first); // the midnight backdrop is arriving again
    expect(s.current).toMatchObject({ dir: 'up', from: aurora, fromScene: AURORA });
    expect(s.frame(1000 + 0.3 * SWEEP_MS)?.cover).toBeCloseTo(mid); // no jump
    expect(s.frame(1000 + 0.4 * SWEEP_MS)?.cover).toBeLessThan(mid); // and it goes back up
    expect(s.frame(1000 + 0.3 * SWEEP_MS + 0.31 * SWEEP_MS)).toBeNull();
    expect(s.current).toBeNull();
  });

  it('a toggle back before the sweep has started settles at once', () => {
    const s = sized(new SkySweep());
    s.frame(900);
    s.change(SCENES.midnight, AURORA, { now: 1225, reduced: false }, true);
    s.change(AURORA, SCENES.midnight, { now: 1225, reduced: false }, true);
    expect(s.frame(950)).toBeNull();
  });

  it('reduced motion reverses the crossfade the same way', () => {
    const s = sized(new SkySweep());
    s.change(SCENES.midnight, AURORA, { now: 0, reduced: true }, true);
    expect(s.frame(SWEEP_FADE_MS * 0.25)?.alpha).toBeCloseTo(0.25);
    s.change(AURORA, SCENES.midnight, { now: SWEEP_FADE_MS * 0.25, reduced: true }, true);
    expect(s.frame(SWEEP_FADE_MS * 0.25)?.alpha).toBeCloseTo(0.25);
    expect(s.frame(SWEEP_FADE_MS * 0.5)).toBeNull();
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
