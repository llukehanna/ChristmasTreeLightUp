// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FaceSprites } from '../../../src/render/face-sprites';

const img = { naturalWidth: 240, naturalHeight: 256 } as HTMLImageElement;
let made = 0;

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  made = 0;
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') made++;
    return create(tag);
  }) as typeof document.createElement);
  const ctx = new Proxy(
    { getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => undefined), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
});

it('nothing until the sticker has loaded', () => {
  const f = new FaceSprites(() => null);
  expect(f.ready).toBe(false);
  expect(f.get('ornament', 40, true)).toBeNull();
});

it('caches a lit and a dim copy per slot, in 8 px steps', () => {
  const f = new FaceSprites(() => img);
  expect(f.ready).toBe(true);
  const lit = f.get('ornament', 33, true);
  const after = made;
  expect(lit?.height).toBe(40);
  const dim = f.get('ornament', 39, false);
  expect(dim).not.toBe(lit);
  expect(f.get('ornament', 38, true)).toBe(lit);
  expect(made).toBe(after);
  expect(f.get('ornament', 41, true)?.height).toBe(48);
  expect(made).toBeGreaterThan(after);
  expect(f.get('garland', 33, true)).not.toBe(f.get('ornament', 41, true));
});
