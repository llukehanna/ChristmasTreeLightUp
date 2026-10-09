// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { drawFaceBulb } from '../../../src/render/bulbs';
import type { FaceSprites } from '../../../src/render/face-sprites';
import { faceGarlandIndex, faceGiftIndex } from '../../../src/render/faces';
import { Garland } from '../../../src/render/garland';
import { computeLayout } from '../../../src/render/layout';
import { FACE_PAPER, Presents, placePresents } from '../../../src/render/presents';
import { AURORA } from '../../../src/render/scenes';

function recorder(names: string[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (..._: unknown[]) => {
        names.push(String(k));
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
const sprite = { width: 30, height: 32 } as HTMLCanvasElement;

/** Every call with its arguments and the alpha it was made at; `save`/`restore` keep the alpha as a context does. */
type Call = { name: string; args: unknown[]; alpha: number };
function logger(calls: Call[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
  const stack: number[] = [];
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        calls.push({ name: String(k), args, alpha: t.globalAlpha as number });
        if (k === 'save') stack.push(t.globalAlpha as number);
        if (k === 'restore') t.globalAlpha = stack.pop() ?? 1;
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
const draws = (calls: Call[]) => calls.filter((c) => c.name === 'drawImage');

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([])) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('the face ornament: the socket and one sticker, never the glass', () => {
  const names: string[] = [];
  drawFaceBulb(recorder(names), 1, 1, 40, AURORA, sprite);
  expect(names.filter((n) => n === 'drawImage')).toHaveLength(1);
  expect(names).toContain('roundRect');
  expect(names).not.toContain('arc');
});

describe('the face ornament', () => {
  it('stays upright while its tile turns: the turn is undone just before the sticker', () => {
    const calls: Call[] = [];
    drawFaceBulb(logger(calls), 1, 0, 40, AURORA, sprite, 0.7);
    const k = calls.findIndex((c) => c.name === 'drawImage');
    const rotates = calls.slice(0, k).filter((c) => c.name === 'rotate');
    expect(rotates.at(-1)?.args[0]).toBe(-0.7);
    // The socket still turns with the tile (it is drawn in the tile's frame, at the bulb's own angle).
    expect(calls.findIndex((c) => c.name === 'roundRect')).toBeLessThan(k);
  });
  it('unlit at the alpha it is given; lit at min(1, 0.35 + amt), swelling with the pop; the alpha is put back', () => {
    const at = (amt: number, alpha = 1) => {
      const calls: Call[] = [];
      const c = logger(calls);
      c.globalAlpha = alpha;
      drawFaceBulb(c, 1, amt, 40, AURORA, sprite);
      expect(c.globalAlpha).toBe(alpha);
      const d = draws(calls);
      expect(d).toHaveLength(1);
      return { alpha: d[0].alpha, h: d[0].args[4] as number };
    };
    expect(at(0, 0.6).alpha).toBe(0.6);
    expect(at(0.3).alpha).toBeCloseTo(0.65);
    expect(at(1).alpha).toBe(1);
    expect(at(1).h).toBeCloseTo(40 * 0.56);
    expect(at(2).h).toBeCloseTo(40 * 0.56 * 1.35);
  });
});

describe('the garland face', () => {
  it('dim while its bulb is dark, lit once it lights, one drawImage either way', () => {
    const g = new Garland();
    g.layout(390, 40, 46);
    g.face = faceGarlandIndex(g.geo);
    const dark: string[] = [];
    g.drawFace(recorder(dark), 1000, null, false, sprite, sprite, 0);
    expect(dark.filter((n) => n === 'drawImage')).toHaveLength(1);
    g.update(1, 1000);
    const lit: string[] = [];
    g.drawFace(recorder(lit), 2000, null, false, sprite, sprite, 0);
    expect(lit.filter((n) => n === 'drawImage')).toHaveLength(1);
  });
  it('dim and lit both while the bulb is coming on (amount between 0 and 1)', () => {
    const g = new Garland();
    g.layout(390, 40, 46);
    g.face = faceGarlandIndex(g.geo);
    g.update(1, 1000);
    const a = g.amount(g.face, 1010, null, false);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    const calls: Call[] = [];
    const dim = { width: 30, height: 32 } as HTMLCanvasElement;
    g.drawFace(logger(calls), 1010, null, false, sprite, dim, 0);
    expect(draws(calls).map((c) => [c.args[0], c.alpha])).toEqual([[dim, 1], [sprite, a]]);
  });
  it("leaves the face bulb's glass out of the back layer and the lit glass", () => {
    const glass = (face: number) => {
      const back: Call[] = [];
      const lit: Call[] = [];
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => logger(back)) as never);
      // jsdom has no Path2D: the wire's paths only need to record their points.
      vi.stubGlobal('Path2D', class { moveTo(): void {} lineTo(): void {} });
      const g = new Garland();
      g.layout(390, 40, 46);
      g.paint(AURORA, 2, face);
      g.update(1, 0);
      g.drawLit(logger(lit), AURORA, 5000, null, true);
      // Each glass is one radial gradient: unlit in the back layer, lit in drawLit (reduced motion: no hot spot).
      const radial = (calls: Call[]) => calls.filter((c) => c.name === 'createRadialGradient').length;
      return { back: radial(back), lit: radial(lit), n: g.geo.n };
    };
    const plain = glass(-1);
    expect(plain.back).toBe(plain.n);
    expect(plain.lit).toBe(plain.n);
    const faced = glass(9);
    expect(faced.back).toBe(plain.n - 1);
    expect(faced.lit).toBe(plain.n - 1);
  });
  it('draws nothing without a face bulb or a sticker', () => {
    const g = new Garland();
    g.layout(390, 40, 46);
    const names: string[] = [];
    g.drawFace(recorder(names), 1000, null, false, sprite, sprite, 0);
    g.face = 3;
    g.drawFace(recorder(names), 1000, null, false, null, null, 0);
    expect(names).not.toContain('drawImage');
  });
});

describe('the face present', () => {
  const L = computeLayout(390, 844, 2);
  it('wraps the chosen gift in face paper, both passes printed from the sticker', () => {
    const get = vi.fn((_slot: string, _size: number, _lit: boolean) => sprite);
    const p = new Presents();
    p.layout(L, GRID, AURORA, { ready: true, get } as unknown as FaceSprites);
    expect(p.faceIndex).toBe(faceGiftIndex(placePresents(L, GRID)));
    expect(p.gifts[p.faceIndex].paper).toBe(FACE_PAPER);
    expect(get.mock.calls.map((c) => [c[0], c[2]])).toEqual([['paper', false], ['paper', true]]);
  });
  it("shades the print per box face at layout time and frees those copies: only each gift's two sprites keep pixels", () => {
    const made: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = create(tag);
      if (tag === 'canvas') made.push(el as HTMLCanvasElement);
      return el;
    }) as typeof document.createElement);
    const p = new Presents();
    p.layout(L, GRID, AURORA, { ready: true, get: () => sprite } as unknown as FaceSprites);
    const faced = [...made];
    // Every canvas but the gifts' base and light sprites was freed, the shaded copies among them.
    expect(faced.filter((c) => c.width > 0)).toHaveLength(2 * p.gifts.length);
    const gift = p.gifts[p.faceIndex];
    made.length = 0;
    p.layout(L, GRID, AURORA, null);
    // The face gift's shaded copies are the only extra canvases: per pass, the side (when it shows), the front, the
    // lid's front and the top.
    expect(faced.length - made.length).toBe(2 * (Math.abs(gift.sx) > 0.5 ? 4 : 3));
  });
  it('plain paper without the sticker', () => {
    const p = new Presents();
    p.layout(L, GRID, AURORA, null);
    expect(p.faceIndex).toBe(-1);
    expect(p.gifts.some((g) => g.paper === FACE_PAPER)).toBe(false);
  });
});
