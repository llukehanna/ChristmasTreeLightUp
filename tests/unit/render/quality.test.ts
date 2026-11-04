import { describe, expect, it } from 'vitest';
import { QualityGovernor, frameDue, isCalm, type CalmState } from '../../../src/render/quality';

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

it('draws every frame while busy, at any refresh rate', () => {
  expect(frameDue(8.3, false)).toBe(true); // 120 Hz: no cap
  expect(frameDue(16.7, false)).toBe(true);
});
it('calm frames come at most every 28 ms', () => {
  expect(frameDue(16.7, true)).toBe(false);
  expect(frameDue(27.9, true)).toBe(false);
  expect(frameDue(28, true)).toBe(true);
  expect(frameDue(33.3, true)).toBe(true);
});

describe('isCalm', () => {
  const idle: CalmState = { now: 10_000, busyUntil: 5000, paused: false, musicDriven: false, sweeping: false, topperNeedsFrame: false };

  it('an idle, unpaused tree is calm', () => expect(isCalm(idle)).toBe(true));
  it('is not calm while the player\'s motion settles', () => expect(isCalm({ ...idle, busyUntil: 10_001 })).toBe(false));
  it('is not calm while music drives the frames (the light show, the beat)', () => expect(isCalm({ ...idle, musicDriven: true })).toBe(false));

  it('a paused loop is calm even inside the grace period or with music', () => {
    expect(isCalm({ ...idle, paused: true, busyUntil: 99_999, musicDriven: true })).toBe(true);
  });

  it('a sky sweep or a topper flip is never calm, paused or not', () => {
    for (const paused of [false, true]) {
      expect(isCalm({ ...idle, paused, sweeping: true })).toBe(false);
      expect(isCalm({ ...idle, paused, topperNeedsFrame: true })).toBe(false);
    }
  });

  it('a calm paused loop is held to 30 Hz by frameDue', () => {
    const calm = isCalm({ ...idle, paused: true });
    expect(frameDue(8.3, calm)).toBe(false);
    expect(frameDue(28, calm)).toBe(true);
  });
});
