import { expect, it, vi } from 'vitest';
import { WIN_SOUND_LATE_MS, WinSound } from '../../../src/radio/win-sound';

function fakeCtx() {
  const started: unknown[] = [];
  const ctx = {
    decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ length: b.byteLength })),
    createBufferSource: () => {
      const src = { buffer: null as unknown, connect: vi.fn(), start: () => started.push(src) };
      return src;
    },
  };
  return { ctx: ctx as unknown as AudioContext, started };
}
const out = {} as AudioNode;
const bytes = () => new Response(new Uint8Array(8));

it('fetches and decodes once per URL, then plays it once on the bus it is given', async () => {
  const fetchFn = vi.fn(async () => bytes());
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  w.preload('/w.mp3', ctx);
  w.preload('/w.mp3', ctx);
  expect(await w.play('/w.mp3', ctx, out)).toBe(true);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(started).toHaveLength(1);
});

it('does nothing without a URL or a context', () => {
  const fetchFn = vi.fn(async () => bytes());
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  w.preload(null, fakeCtx().ctx);
  w.preload('/w.mp3', null);
  expect(fetchFn).not.toHaveBeenCalled();
});

it('forgets a failure, so the next try fetches again', async () => {
  let ok = false;
  const fetchFn = vi.fn(async () => (ok ? bytes() : new Response('', { status: 404 })));
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  expect(await w.play('/w.mp3', ctx, out)).toBe(false);
  ok = true;
  expect(await w.play('/w.mp3', ctx, out)).toBe(true);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(started).toHaveLength(1);
});

it('drops an ad-lib decoded more than 3 s after the win', async () => {
  let t = 0;
  const fetchFn = vi.fn(async () => {
    t += WIN_SOUND_LATE_MS + 1;
    return bytes();
  });
  const w = new WinSound(fetchFn as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  expect(await w.play('/w.mp3', ctx, out, () => t)).toBe(false);
  expect(started).toHaveLength(0);
});
