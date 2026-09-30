import { expect, it } from 'vitest';
import { QualityGovernor } from '../../../src/render/quality';

it('drops a tier after ~1s of slow frames and recovers after ~5s of fast ones', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 30; k++) q.sample(40);
  expect(q.tier).toBe(1);
  for (let k = 0; k < 450; k++) q.sample(12);
  expect(q.tier).toBe(0);
});
it('never goes past tier 3', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 1000; k++) q.sample(40);
  expect(q.tier).toBe(3);
});
it('holds full quality under a steady 30 Hz rAF cap when the work itself is light', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 300; k++) q.sample(33.3, 6); // 10s of Low Power Mode frames
  expect(q.tier).toBe(0);
});
it('recovers under a 30 Hz cap once the work is light', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 30; k++) q.sample(40);
  expect(q.tier).toBe(1);
  for (let k = 0; k < 160; k++) q.sample(33.3, 5); // ~5.3s
  expect(q.tier).toBe(0);
});
it('treats heavy work at a 30 Hz interval as slow, counting wall time towards the window', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 29; k++) q.sample(33.3, 25); // ~0.97s
  expect(q.tier).toBe(0);
  for (let k = 0; k < 2; k++) q.sample(33.3, 25);
  expect(q.tier).toBe(1);
});
it('drops a tier on a GPU-bound device even when the JS work is light', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 25; k++) q.sample(45, 6); // ~22 fps, deferred GPU cost invisible to the work timer
  expect(q.tier).toBe(1);
});
it('recovers at a normal 60 Hz frame rate', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 30; k++) q.sample(40);
  expect(q.tier).toBe(1);
  for (let k = 0; k < 320; k++) q.sample(16.7);
  expect(q.tier).toBe(0);
});
