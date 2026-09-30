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
