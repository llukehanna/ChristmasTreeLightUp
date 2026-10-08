import { readJSON, removeKey, writeJSON } from '../store/storage';
import { MAX_CLAIMS_PER_REQUEST } from './types';

/** Signed-out runs this browser can still claim (spec §5.4). The server keeps unclaimed finished games as long. */
const KEY = 'aglow.claims';
export const CLAIM_TTL_MS = 90 * 86_400_000;
/** Oldest claims go first past this many. */
export const MAX_STORED_CLAIMS = 500;

export interface StoredClaim {
  id: string;
  claim: string;
  at: number;
}

const isClaims = (v: unknown): v is StoredClaim[] =>
  Array.isArray(v) &&
  v.every((c) => {
    if (typeof c !== 'object' || c === null) return false;
    const o = c as Record<string, unknown>;
    return typeof o.id === 'string' && typeof o.claim === 'string' && typeof o.at === 'number' && Number.isFinite(o.at);
  });

export function readClaims(now: number): StoredClaim[] {
  return (readJSON(KEY, isClaims) ?? []).filter((c) => now - c.at < CLAIM_TTL_MS);
}

export function addClaim(c: { id: string; claim: string }, now: number): void {
  writeJSON(KEY, [...readClaims(now).filter((x) => x.id !== c.id), { id: c.id, claim: c.claim, at: now }].slice(-MAX_STORED_CLAIMS));
}

/** Drops the claims the server has seen (claimed or not: a refused claim never succeeds later). */
export function removeClaims(ids: readonly string[]): void {
  const drop = new Set(ids);
  const keep = (readJSON(KEY, isClaims) ?? []).filter((c) => !drop.has(c.id));
  if (keep.length) writeJSON(KEY, keep);
  else removeKey(KEY);
}

export function claimBatches(claims: readonly StoredClaim[], size = MAX_CLAIMS_PER_REQUEST): { id: string; claim: string }[][] {
  const out: { id: string; claim: string }[][] = [];
  for (let i = 0; i < claims.length; i += size) out.push(claims.slice(i, i + size).map(({ id, claim }) => ({ id, claim })));
  return out;
}

/**
 * Runs `task` one at a time. A call while it runs isn't dropped: it marks one more run, which starts as soon as the
 * current one ends (however many calls came meanwhile). App.claimAll uses it so a claim stored while a claim request
 * is in flight (a new run finished) still goes out.
 */
export function coalesced(task: () => Promise<void>): () => Promise<void> {
  let running = false;
  let again = false;
  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
      if (again) {
        again = false;
        run().catch(() => undefined);
      }
    }
  };
  return run;
}
