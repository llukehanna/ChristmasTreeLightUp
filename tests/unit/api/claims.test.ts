// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { addClaim, CLAIM_TTL_MS, claimBatches, MAX_STORED_CLAIMS, readClaims, removeClaims } from '../../../src/api/claims';

beforeEach(() => localStorage.clear());

it('keeps a claim for 90 days', () => {
  addClaim({ id: 'a', claim: 'x' }, 1000);
  expect(readClaims(1000 + CLAIM_TTL_MS - 1)).toEqual([{ id: 'a', claim: 'x', at: 1000 }]);
  expect(readClaims(1000 + CLAIM_TTL_MS)).toEqual([]);
});

it('keeps at most 500, dropping the oldest, and replaces a repeat', () => {
  for (let k = 0; k < MAX_STORED_CLAIMS + 2; k++) addClaim({ id: `g${k}`, claim: 'x' }, k);
  const all = readClaims(MAX_STORED_CLAIMS + 2);
  expect(all).toHaveLength(MAX_STORED_CLAIMS);
  expect(all[0].id).toBe('g2');
  addClaim({ id: 'g2', claim: 'y' }, 999);
  expect(readClaims(999).filter((c) => c.id === 'g2')).toEqual([{ id: 'g2', claim: 'y', at: 999 }]);
});

it('removes the claims the server has seen, and the key once none are left', () => {
  addClaim({ id: 'a', claim: 'x' }, 1);
  addClaim({ id: 'b', claim: 'y' }, 2);
  removeClaims(['a']);
  expect(readClaims(3)).toEqual([{ id: 'b', claim: 'y', at: 2 }]);
  removeClaims(['b']);
  expect(localStorage.getItem('aglow.claims')).toBeNull();
});

it('ignores corrupt storage', () => {
  localStorage.setItem('aglow.claims', '{"no":1}');
  expect(readClaims(0)).toEqual([]);
  localStorage.setItem('aglow.claims', '[{"id":1}]');
  expect(readClaims(0)).toEqual([]);
});

it('sends 8 claims per request, without the timestamps', () => {
  const claims = Array.from({ length: 17 }, (_, k) => ({ id: `g${k}`, claim: 'x', at: k }));
  const batches = claimBatches(claims);
  expect(batches.map((b) => b.length)).toEqual([8, 8, 1]);
  expect(batches[0][0]).toEqual({ id: 'g0', claim: 'x' });
});
