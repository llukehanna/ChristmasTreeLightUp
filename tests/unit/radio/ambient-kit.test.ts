// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { Biquad, brownLoop, pinkLoop, smoothRandomLoop, Stream } from '../../../src/radio/ambient-kit';
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

/** Just enough of an audio context to start an ambience, at a low rate so the noise is quick to make. `made` counts buffers. */
function fakeCtx() {
  const ctx = {
    made: 0,
    sampleRate: 4000,
    currentTime: 0,
    state: 'running',
    createBuffer(_channels: number, length: number, rate: number) {
      ctx.made++;
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

afterEach(() => {
  vi.restoreAllMocks();
});

it('after prewarm, start generates nothing', async () => {
  for (const make of [() => new Fireplace(mulberry32(1)), () => new Rain(mulberry32(1)), () => new Storm(mulberry32(1))]) {
    const ctx = fakeCtx();
    const s = make();
    const sched = manualIdle();
    const done = s.prewarm(as(ctx), sched.idle);
    await sched.drain();
    await done;
    const made = ctx.made;
    expect(made).toBeGreaterThan(0);
    s.start(as(ctx), out());
    expect(ctx.made).toBe(made);
    s.stop();
  }
});

it('prewarm yields between buffers', async () => {
  const ctx = fakeCtx();
  const sched = manualIdle();
  let finished = false;
  void new Fireplace(mulberry32(2)).prewarm(as(ctx), sched.idle).then(() => (finished = true));
  await new Promise((r) => setTimeout(r, 0));
  expect(ctx.made).toBe(0); // nothing is made before the first idle slice
  let slices = 0;
  while (sched.queue.length) {
    expect(sched.queue.length).toBe(1); // one slice at a time
    const before = ctx.made;
    await sched.slice();
    slices++;
    expect(ctx.made).toBeGreaterThan(before); // each slice makes one more set of buffers
  }
  expect(finished).toBe(true);
  expect(slices).toBe(6); // the beds and five crackle pools
});

it('starting while prewarm is half done builds each buffer once', async () => {
  const fresh = fakeCtx();
  const first = new Fireplace(mulberry32(3));
  first.start(as(fresh), out());
  first.stop();
  const all = fresh.made;

  const ctx = fakeCtx();
  const fire = new Fireplace(mulberry32(3));
  const sched = manualIdle();
  const done = fire.prewarm(as(ctx), sched.idle);
  await new Promise((r) => setTimeout(r, 0));
  await sched.slice();
  await sched.slice();
  expect(ctx.made).toBeGreaterThan(0);
  expect(ctx.made).toBeLessThan(all);
  fire.start(as(ctx), out()); // makes the rest at once
  expect(ctx.made).toBe(all);
  await sched.drain(); // the rest of the prewarm finds every buffer made
  await done;
  expect(ctx.made).toBe(all);
  fire.stop();
});

it('Rain and Storm share their beds', async () => {
  const ctx = fakeCtx();
  const sched = manualIdle();
  const done = new Rain(mulberry32(4)).prewarm(as(ctx), sched.idle);
  await sched.drain();
  await done;
  const afterRain = ctx.made;
  const storm = new Storm(mulberry32(4));
  storm.start(as(ctx), out());
  expect(ctx.made - afterRain).toBe(2); // only its own heavier patter loops
  storm.stop();
});
