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

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([])) as never);
});
afterEach(() => vi.restoreAllMocks());

it('the face ornament: the socket and one sticker, never the glass', () => {
  const names: string[] = [];
  drawFaceBulb(recorder(names), 1, 1, 40, AURORA, sprite);
  expect(names.filter((n) => n === 'drawImage')).toHaveLength(1);
  expect(names).toContain('roundRect');
  expect(names).not.toContain('arc');
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
    const plain = made.length;
    expect(made.filter((c) => c.width > 0)).toHaveLength(2 * p.gifts.length);
    made.length = 0;
    p.layout(L, GRID, AURORA, null);
    // The face gift's shaded copies are the only extra canvases: one per box face it shows, per pass.
    expect(plain - made.length).toBeGreaterThanOrEqual(6);
  });
  it('plain paper without the sticker', () => {
    const p = new Presents();
    p.layout(L, GRID, AURORA, null);
    expect(p.faceIndex).toBe(-1);
    expect(p.gifts.some((g) => g.paper === FACE_PAPER)).toBe(false);
  });
});
