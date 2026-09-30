import { expect, it } from 'vitest';
import { QualityGovernor } from '../../../src/render/quality';

it('drops a tier after ~1s of slow frames and recovers after ~5s of fast ones', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 40; k++) q.sample(30);
  expect(q.tier).toBe(1);
  for (let k = 0; k < 450; k++) q.sample(12);
  expect(q.tier).toBe(0);
});
it('never goes past tier 3', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 1000; k++) q.sample(40);
  expect(q.tier).toBe(3);
});
it('holds full quality under a 30 Hz rAF cap when the work itself is fast', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 300; k++) q.sample(6, 33.3); // 10s of Low Power Mode frames
  expect(q.tier).toBe(0);
});
it('counts wall time towards the windows when the work is slow', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 29; k++) q.sample(25, 33.3); // ~0.97s
  expect(q.tier).toBe(0);
  for (let k = 0; k < 2; k++) q.sample(25, 33.3);
  expect(q.tier).toBe(1);
});
it('recovers at a normal 60 Hz frame rate', () => {
  const q = new QualityGovernor();
  for (let k = 0; k < 40; k++) q.sample(30);
  expect(q.tier).toBe(1);
  for (let k = 0; k < 320; k++) q.sample(16.7);
  expect(q.tier).toBe(0);
});
