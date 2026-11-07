import type { GhostRun } from '../api/types';
import { MAX_FACTS_ENTRIES } from '../core/facts';
import { parseLog } from '../core/log';
import { GRID } from '../core/mask';
import { readJSON, removeKey, writeJSON } from './storage';

/**
 * Your fastest finished run on each Daily day's tree, on this device (C4 decision 6): a guest's ghost, and a signed-in
 * player's while the server's answer is on its way. `{ [YYYY-MM-DD]: GhostRun }`, at most MAX_DAYS days.
 */
const KEY = 'aglow.ghosts';
/** The ghost toggle (decision 7): absent is on, 0 is off. */
const ON_KEY = 'aglow.ghost';
/** A month of days: the oldest day goes first. */
const MAX_DAYS = 31;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isStore = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored run as a GhostRun, or null when anything about it is off (the log is checked as the server checks one). */
function asGhost(v: unknown): GhostRun | null {
  if (!isStore(v)) return null;
  const { seed, genVersion, log, ms } = v;
  if (typeof seed !== 'number' || typeof genVersion !== 'number' || typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const parsed = parseLog(log, GRID);
  return parsed ? { seed, genVersion, log: parsed, ms } : null;
}

/** The stored day's ghost, or null (none, corrupt, or storage blocked). */
export function loadGhost(day: string): GhostRun | null {
  const store = readJSON(KEY, isStore);
  return store && Object.hasOwn(store, day) ? asGhost(store[day]) : null;
}

/**
 * A finished run on `day`'s tree, offered as its ghost: kept when the day has none or a slower one. A log longer than
 * MAX_FACTS_ENTRIES isn't kept (it would cost a long replay at the tree's start). Past MAX_DAYS days the oldest goes.
 */
export function offerGhost(day: string, run: GhostRun): void {
  if (!DAY.test(day) || run.log.length > MAX_FACTS_ENTRIES) return;
  const store: Record<string, GhostRun> = {};
  for (const [d, v] of Object.entries(readJSON(KEY, isStore) ?? {})) {
    const g = DAY.test(d) ? asGhost(v) : null;
    if (g) store[d] = g;
  }
  const held = store[day];
  if (held && held.ms <= run.ms) return;
  store[day] = { seed: run.seed, genVersion: run.genVersion, log: run.log, ms: run.ms };
  const days = Object.keys(store).sort();
  for (const d of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete store[d];
  writeJSON(KEY, store);
}

/**
 * The ghost for the tree in play: the fastest of `runs` with its seed and generator version. A run from any other tree
 * (a day whose tree was made again, or by another generator) is never one (review focus 5).
 */
export function pickGhost(tree: { seed: number; genVersion: number }, ...runs: (GhostRun | null)[]): GhostRun | null {
  let best: GhostRun | null = null;
  for (const r of runs) {
    if (r && r.seed === tree.seed && r.genVersion === tree.genVersion && (best === null || r.ms < best.ms)) best = r;
  }
  return best;
}

/** The ghost toggle: on unless this device turned it off. */
export const ghostOn = (): boolean => readJSON(ON_KEY, (v): v is 0 => v === 0) !== 0;

export function setGhostOn(on: boolean): void {
  if (on) removeKey(ON_KEY);
  else writeJSON(ON_KEY, 0);
}
