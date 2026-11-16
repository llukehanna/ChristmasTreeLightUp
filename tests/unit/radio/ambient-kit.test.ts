// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { AMBIENT_RATE, Biquad, brownLoop, clearRendered, offThread, pinkLoop, renderedKeys, smoothRandomLoop, Stream } from '../../../src/radio/ambient-kit';
import { answer, RECIPES } from '../../../src/radio/ambient-recipes';
import { Fireplace, settleGap, strike } from '../../../src/radio/fireplace';
import { patterLoop, Rain } from '../../../src/radio/rain';
import { Storm, thunderGap } from '../../../src/radio/storm';

const maxStep = (d: Float32Array): number => {
  let m = 0;
  for (let i = 1; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - d[i - 1]));
  return m;
};
const rms = (d: Float32Array): number => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);

it('noise loops wrap with no step bigger than any step inside them', () => {
  for (const make of [pinkLoop, brownLoop]) {
    const d = make(48000, mulberry32(3));
    expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep(d));
    expect(rms(d)).toBeGreaterThan(0.03);
    expect(rms(d)).toBeLessThan(0.6);
  }
});

it('a loop filtered with runLoop joins seamlessly', () => {
  const d = new Float32Array(24000);
  const r = mulberry32(5);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  Biquad.lowpass(300, 0.7, 48000).runLoop(d);
  // The wrap-around behaves like any other step of the filtered signal.
  expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep(d));
});

it('a crackle starts softly, peaks at 1 and dies away', () => {
  const d = strike(48000, mulberry32(2), { burstMs: 2, modes: [[1800, 12, 1]], click: 0.4, lp: 6000, maxMs: 80 });
  const peak = d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(peak).toBeCloseTo(1, 5);
  expect(Math.abs(d[0])).toBeLessThan(0.05); // no step at the start: no click
  expect(Math.abs(d[d.length - 1])).toBeLessThan(1e-3);
  expect(d.length).toBeLessThanOrEqual(48 * 80);
});

it('a smooth random signal stays in [-1, 1] and loops', () => {
  const d = smoothRandomLoop(9600, 48000, 0.05, mulberry32(4));
  expect(Math.max(...d)).toBeLessThanOrEqual(1);
  expect(Math.min(...d)).toBeGreaterThanOrEqual(-1);
  expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep(d) * 2);
});

it('a stream fires in order through contiguous windows, and skips the backlog after a suspension', () => {
  const fired: number[] = [];
  const s = new Stream(() => 0.25, (t) => fired.push(t), 0);
  s.run(0, 1);
  s.run(1, 2);
  expect(fired).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
  fired.length = 0;
  s.run(60, 61); // the context was suspended for a minute: no burst of 232 events
  expect(fired.length).toBeLessThanOrEqual(4);
  expect(fired.every((t) => t >= 60 && t < 61)).toBe(true);
});

it('a log settles every 60 to 150 s', () => {
  const r = mulberry32(11);
  for (let i = 0; i < 200; i++) {
    const g = settleGap(r);
    expect(g).toBeGreaterThanOrEqual(60);
    expect(g).toBeLessThanOrEqual(150);
  }
});

it('patterLoop is finite and seamless at RMS 0.25', () => {
  const [l, r] = patterLoop(48000, 1, 300, mulberry32(8), [1500, 5000], [0.4, 1.4]);
  for (const d of [l, r]) {
    expect(d.every(Number.isFinite)).toBe(true);
    expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep(d));
  }
  expect(Math.sqrt((rms(l) ** 2 + rms(r) ** 2) / 2)).toBeCloseTo(0.25, 2);
});

it('thunder rolls every 20 to 60 s', () => {
  const r = mulberry32(12);
  for (let i = 0; i < 200; i++) {
    const g = thunderGap(r);
    expect(g).toBeGreaterThanOrEqual(20);
    expect(g).toBeLessThanOrEqual(60);
  }
});

/* ---------- pre-generating the noise at idle ---------- */

const param = () => ({ value: 1, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined, setTargetAtTime: () => undefined });
const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined });

/** Just enough of an audio context to start an ambience. `made` counts the AudioBuffers wrapped, `rates` their rates. */
function fakeCtx() {
  const ctx = {
    made: 0,
    sampleRate: 44100,
    rates: [] as number[],
    currentTime: 0,
    state: 'running',
    createBuffer(_channels: number, length: number, rate: number) {
      ctx.made++;
      ctx.rates.push(rate);
      return { duration: length / rate, copyToChannel: () => undefined };
    },
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createStereoPanner: () => ({ ...node(), pan: param() }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, playbackRate: param(), start: () => undefined, stop: () => undefined }),
  };
  return ctx;
}
const as = (c: ReturnType<typeof fakeCtx>) => c as unknown as BaseAudioContext;
const out = () => node() as unknown as AudioNode;

/** A hand-run idle scheduler: each queued slice runs only when the test says so. */
function manualIdle() {
  const queue: (() => void)[] = [];
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    queue,
    idle: (fn: () => void) => void queue.push(fn),
    async slice() {
      queue.shift()?.();
      await settle();
    },
    async drain() {
      await settle();
      while (queue.length) await this.slice();
    },
  };
}

beforeEach(clearRendered);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
});

it('prewarm needs no audio context, and a start after it renders nothing', async () => {
  for (const make of [() => new Fireplace(mulberry32(1)), () => new Rain(mulberry32(1)), () => new Storm(mulberry32(1))]) {
    clearRendered();
    const s = make();
    const sched = manualIdle();
    const done = s.prewarm(sched.idle);
    await sched.drain();
    await done;
    const rendered = renderedKeys();
    expect(rendered.length).toBeGreaterThan(0);
    const ctx = fakeCtx();
    expect(ctx.made).toBe(0); // the context came after: only now is anything wrapped
    s.start(as(ctx), out());
    expect(renderedKeys()).toEqual(rendered);
    expect(ctx.made).toBeGreaterThan(0);
    s.stop();
  }
});

it('the samples are rendered at one fixed rate, whatever the context runs at', () => {
  for (const sampleRate of [44100, 48000, 96000]) {
    const ctx = fakeCtx();
    ctx.sampleRate = sampleRate;
    const fire = new Fireplace(mulberry32(7));
    fire.start(as(ctx), out());
    fire.stop();
    expect(new Set(ctx.rates)).toEqual(new Set([AMBIENT_RATE]));
  }
});

it('prewarm yields between buffers', async () => {
  const sched = manualIdle();
  let finished = false;
  void new Fireplace(mulberry32(2)).prewarm(sched.idle).then(() => (finished = true));
  await new Promise((r) => setTimeout(r, 0));
  expect(renderedKeys()).toEqual([]); // nothing is made before the first idle slice
  let slices = 0;
  while (sched.queue.length) {
    expect(sched.queue.length).toBe(1); // one slice at a time
    const before = renderedKeys().length;
    await sched.slice();
    slices++;
    expect(renderedKeys().length).toBe(before + 1); // each slice makes one more set of buffers
  }
  expect(finished).toBe(true);
  expect(slices).toBe(6); // the beds and five crackle pools
});

it('starting while prewarm is half done renders each set once, in the order of a cold start', async () => {
  const cold = new Fireplace(mulberry32(3));
  cold.start(as(fakeCtx()), out());
  cold.stop();
  const all = renderedKeys();
  expect(all).toHaveLength(6);
  clearRendered();

  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(3));
  const sched = manualIdle();
  const done = fire.prewarm(sched.idle);
  await new Promise((r) => setTimeout(r, 0));
  await sched.slice();
  await sched.slice();
  expect(renderedKeys()).toHaveLength(2);
  fire.start(as(ctx), out()); // renders the rest at once, in the same order
  expect(renderedKeys()).toEqual(all);
  await sched.drain(); // the rest of the prewarm finds every set made
  await done;
  expect(renderedKeys()).toEqual(all);
  fire.stop();
});

it('Rain and Storm share their beds, and a second context only wraps the samples', async () => {
  const ctx = fakeCtx();
  const sched = manualIdle();
  const done = new Rain(mulberry32(4)).prewarm(sched.idle);
  await sched.drain();
  await done;
  const afterRain = renderedKeys();
  const storm = new Storm(mulberry32(4));
  storm.start(as(ctx), out());
  expect(renderedKeys().filter((k) => !afterRain.includes(k))).toEqual(['rain:patter-heavy']); // only its own heavier loops
  storm.stop();

  const again = fakeCtx();
  const rain = new Rain(mulberry32(4));
  rain.start(as(again), out());
  expect(renderedKeys()).toHaveLength(afterRain.length + 1); // nothing re-rendered for the new context
  expect(again.made).toBeGreaterThan(0);
  rain.stop();
});

/* ---------- rendering in a worker ---------- */

it('the worker answers each request with the set for its key, the same noise for a seed, and the buffers to transfer', () => {
  for (const key of Object.keys(RECIPES)) {
    const { reply, transfer } = answer({ key, seed: 9 });
    expect(reply.key).toBe(key);
    const channels = reply.pcm.flat();
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.every((c) => c.length > 0 && c.every(Number.isFinite))).toBe(true);
    // Every channel's own buffer goes over, once: a transfer, not a copy.
    expect(transfer).toHaveLength(channels.length);
    expect(new Set(transfer).size).toBe(transfer.length);
    expect(transfer.every((b, i) => b === channels[i].buffer && b.byteLength === channels[i].byteLength)).toBe(true);
  }
  const again = answer({ key: 'fire:snap', seed: 9 }).reply.pcm;
  expect(again).toEqual(RECIPES['fire:snap'](mulberry32(9)));
  expect(answer({ key: 'fire:snap', seed: 10 }).reply.pcm).not.toEqual(again);
  expect(() => answer({ key: 'nope', seed: 1 })).toThrow();
});

/** A stand-in for the module worker: it records what it is asked, and answers when the test says so. */
class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  asked: string[] = [];
  seeds: number[] = [];
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: { key: string; seed: number }) {
    this.asked.push(m.key);
    this.seeds.push(m.seed);
  }
  terminate() {}
  /** Answers every request so far that has not been answered. */
  answerAll() {
    for (const key of this.asked) this.onmessage?.({ data: answer({ key, seed: 1 }).reply });
  }
}
const withWorker = () => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const FIRE_KEYS = ['fire:beds', 'fire:tick', 'fire:snap', 'fire:pop', 'fire:hiss', 'fire:thud'];

it('with a worker, a start that finds sets missing renders nothing here: it asks, waits and begins when they arrive', async () => {
  withWorker();
  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(1));
  fire.start(as(ctx), out());
  expect(fire.running).toBe(true);
  expect(FakeWorker.all).toHaveLength(1);
  expect(FakeWorker.all[0].asked).toEqual(FIRE_KEYS);
  expect(renderedKeys()).toEqual([]);
  expect(ctx.made).toBe(0);
  const [w] = FakeWorker.all;
  w.answerAll();
  await settle();
  expect(renderedKeys()).toEqual(FIRE_KEYS); // what the worker sent, not made here
  expect(ctx.made).toBeGreaterThan(0); // and now it has begun
  expect(FakeWorker.all[0].asked).toEqual(FIRE_KEYS); // nothing asked twice
  fire.stop();
  expect(fire.running).toBe(false);
});

it('with a worker, a start after the sets have come begins at once, and a second ask shares the first', async () => {
  withWorker();
  const rain = new Rain(mulberry32(1));
  rain.warm();
  new Storm(mulberry32(1)).warm();
  const asked = FakeWorker.all[0].asked;
  expect(asked).toEqual(['rain:beds', 'rain:patter', 'rain:tap', 'rain:plop', 'rain:drip', 'rain:patter-heavy']); // the shared beds and pools once
  FakeWorker.all[0].answerAll();
  await settle();
  const ctx = fakeCtx();
  rain.start(as(ctx), out());
  expect(ctx.made).toBeGreaterThan(0);
  rain.stop();
});

it('a stop while the start waits cancels it, and the sets arriving later start nothing', async () => {
  withWorker();
  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(1));
  fire.start(as(ctx), out());
  fire.stop();
  expect(fire.running).toBe(false);
  FakeWorker.all[0].answerAll();
  await settle();
  expect(ctx.made).toBe(0);
  expect(fire.running).toBe(false);
  // A later start is a fresh one: the sets are there, so it begins at once.
  fire.start(as(ctx), out());
  expect(ctx.made).toBeGreaterThan(0);
  fire.stop();
});

it('a start whose sets arrive in a hidden tab begins when the tab is visible again', async () => {
  withWorker();
  let state: DocumentVisibilityState = 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(1));
  fire.start(as(ctx), out());
  FakeWorker.all[0].answerAll();
  await settle();
  expect(ctx.made).toBe(0);
  state = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  expect(ctx.made).toBeGreaterThan(0);
  fire.stop();

});

it('a worker that fails sends the waiting start to render here instead', async () => {
  withWorker();
  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(1));
  fire.start(as(ctx), out());
  FakeWorker.all[0].onerror?.();
  await settle();
  expect(renderedKeys()).toEqual(FIRE_KEYS); // made on this thread
  expect(ctx.made).toBeGreaterThan(0);
  fire.stop();
  // And it is not asked again: the next start finds no worker and renders here.
  clearRendered();
  vi.unstubAllGlobals();
  const again = fakeCtx();
  const rain = new Rain(mulberry32(1));
  rain.start(as(again), out());
  expect(again.made).toBeGreaterThan(0);
  rain.stop();
});

it('a worker that cannot be made is the same as none', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(1));
  fire.start(as(ctx), out());
  await settle(); // the ask failed, so it rendered here and began
  expect(renderedKeys()).toEqual(FIRE_KEYS);
  expect(ctx.made).toBeGreaterThan(0);
  expect(offThread()).toBe(false);
  fire.stop();
});
