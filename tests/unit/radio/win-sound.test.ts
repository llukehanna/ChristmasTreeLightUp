import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIN_SOUND_FETCH_MS, WIN_SOUND_LATE_MS, WIN_SOUND_RETRY_MS, WinSound } from '../../../src/radio/win-sound';

function fakeCtx() {
  const started: unknown[] = [];
  const ctx = {
    decodeAudioData: vi.fn(async (b: ArrayBuffer) => ({ length: b.byteLength, duration: 2.5 })),
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

describe('a request that stalls', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const never = () => vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => undefined));

  it('play still answers on time: false after 3 s', async () => {
    const w = new WinSound(never() as unknown as typeof fetch);
    const { ctx, started } = fakeCtx();
    let result: boolean | null = null;
    void w.play('/w.mp3', ctx, out).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(WIN_SOUND_LATE_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
    expect(started).toHaveLength(0);
  });

  it('is aborted after 15 s and forgotten, so the next try fetches again', async () => {
    const fetchFn = never();
    const w = new WinSound(fetchFn as unknown as typeof fetch);
    const { ctx } = fakeCtx();
    w.preload('/w.mp3', ctx);
    await vi.advanceTimersByTimeAsync(WIN_SOUND_FETCH_MS - 1);
    w.preload('/w.mp3', ctx);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    void w.play('/w.mp3', ctx, out);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

it('after a failure, preloads wait a minute before fetching that URL again; the win itself still tries', async () => {
  let t = 0;
  const fetchFn = vi.fn(async () => new Response('', { status: 404 }));
  const w = new WinSound(fetchFn as unknown as typeof fetch, () => t);
  const { ctx } = fakeCtx();
  w.preload('/w.mp3', ctx);
  await vi.waitFor(() => expect(w.failing('/w.mp3')).toBe(true));
  // Every tile tap preloads: a failing host is not asked again on each one.
  for (const at of [100, 5000, WIN_SOUND_RETRY_MS - 1]) {
    t = at;
    w.preload('/w.mp3', ctx);
  }
  expect(fetchFn).toHaveBeenCalledTimes(1);
  // Another URL is not held back.
  w.preload('/other.mp3', ctx);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  t = WIN_SOUND_RETRY_MS;
  w.preload('/w.mp3', ctx);
  expect(fetchFn).toHaveBeenCalledTimes(3);
  await new Promise((r) => setTimeout(r, 10)); // that one fails too
  t += 10;
  expect(await w.play('/w.mp3', ctx, out, () => t)).toBe(false);
  expect(fetchFn).toHaveBeenCalledTimes(4);
});

it('a success clears the back-off', async () => {
  let ok = false;
  const fetchFn = vi.fn(async () => (ok ? bytes() : new Response('', { status: 404 })));
  const w = new WinSound(fetchFn as unknown as typeof fetch, () => 0);
  const { ctx } = fakeCtx();
  expect(await w.play('/w.mp3', ctx, out)).toBe(false);
  ok = true;
  expect(await w.play('/w.mp3', ctx, out)).toBe(true);
  expect(w.failing('/w.mp3')).toBe(false);
});

it('never starts once the moment has passed (a new tree began while it decoded)', async () => {
  const w = new WinSound(vi.fn(async () => bytes()) as unknown as typeof fetch);
  const { ctx, started } = fakeCtx();
  expect(await w.play('/w.mp3', ctx, out, undefined, () => false)).toBe(false);
  expect(started).toHaveLength(0);
  expect(await w.play('/w.mp3', ctx, out, undefined, () => true)).toBe(true);
  expect(started).toHaveLength(1);
});

it('remembers how long the last ad-lib it started lasts, for the duck', async () => {
  const w = new WinSound(vi.fn(async () => bytes()) as unknown as typeof fetch);
  const { ctx } = fakeCtx();
  expect(w.lastDurationS).toBe(0);
  expect(await w.play('/w.mp3', ctx, out)).toBe(true);
  expect(w.lastDurationS).toBe(2.5);
});
