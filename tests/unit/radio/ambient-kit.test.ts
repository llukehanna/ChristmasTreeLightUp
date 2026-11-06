import { expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { Biquad, brownLoop, pinkLoop, smoothRandomLoop, Stream } from '../../../src/radio/ambient-kit';
import { settleGap, strike } from '../../../src/radio/fireplace';
import { patterLoop } from '../../../src/radio/rain';
import { thunderGap } from '../../../src/radio/storm';

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
