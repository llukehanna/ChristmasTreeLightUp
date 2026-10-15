// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HOME_ALONE_LINE } from '../../../src/ui/results';
import { makeShareImage } from '../../../src/ui/share';

let texts: [string, number][];
beforeEach(() => {
  texts = [];
  const ctx = new Proxy({ canvas: { width: 1080, height: 1350 } } as Record<string | symbol, unknown>, {
    get: (t, k) =>
      k in t ? t[k] : k === 'fillText' ? (s: string, _x: number, y: number) => void texts.push([s, y]) : () => (String(k).startsWith('create') ? { addColorStop() {} } : undefined),
    set: (t, k, v) => ((t[k] = v), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value(cb: BlobCallback) { cb(new Blob(['png'])); } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load: async () => [] } });
});
afterEach(() => vi.restoreAllMocks());

const stage = () => Object.assign(document.createElement('canvas'), { width: 800, height: 600 });
const rect = { x: 100, y: 50, w: 400, h: 500 };
const URL_LINE = 'A G L O W   ·   A G L O W . L U K E G H A N N A . C O M';

it('Home Alone: the line sits between the time and the address', async () => {
  await makeShareImage(stage(), rect, 84, '#fff', HOME_ALONE_LINE);
  const y = (s: string) => texts.find(([t]) => t === s)?.[1] ?? Number.NaN;
  expect(y('Lit in 1:24')).toBeLessThan(y(HOME_ALONE_LINE));
  expect(y(HOME_ALONE_LINE)).toBeLessThan(y(URL_LINE));
});

it('otherwise the caption is as before: the time and the address only', async () => {
  await makeShareImage(stage(), rect, 84, '#fff');
  expect(texts).toEqual([['Lit in 1:24', 1350 - 140], [URL_LINE, 1350 - 80]]);
});
