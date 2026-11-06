import { itemOf, type ItemId } from '../core/catalogue';
import { readJSON, writeJSON } from './storage';

/** What one player has earned on this device, and what they have been told of (season two, Parts C2+C3). */
export interface UnlockRecord {
  /** The server's set when last heard (or the device's alone, for a guest), with this device's own. */
  earned: ItemId[];
  /** Announced already, or theirs before they could be: never fresh again. */
  known: ItemId[];
  /** Seen in the wardrobe: no dot. */
  seen: ItemId[];
  /** A server set has arrived for this player: the next one's new items are news, not the launch-day backlog. */
  synced: boolean;
  /** The trees lit when last heard (the pile, before the progress arrives). */
  treesLit: number;
}

const KEY = 'aglow.unlocks';
/** Players kept on one device; the one saved longest ago goes first. */
const MAX_PLAYERS = 10;

/** The guest, or an account. */
export const playerKey = (userId: number | null): string => (userId === null ? 'guest' : `u${userId}`);

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const items = (v: unknown): ItemId[] | null => (Array.isArray(v) ? v.filter((id): id is ItemId => typeof id === 'string' && itemOf(id) !== undefined) : null);

/** Every player's record, oldest saved first (an object keeps its string keys in insertion order). */
const readAll = (): Record<string, unknown> => readJSON(KEY, isMap) ?? {};

/** A record from storage, field by field: no flag reads as never synced, a missing list as all known (nothing announced). */
function parseRecord(raw: unknown): UnlockRecord | null {
  if (!isMap(raw)) return null;
  const earned = items(raw.earned);
  if (!earned) return null;
  const n = raw.treesLit;
  return {
    earned,
    known: items(raw.known) ?? [...earned],
    seen: items(raw.seen) ?? [...earned],
    synced: raw.synced === true,
    treesLit: typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0,
  };
}

export const loadUnlocks = (key: string): UnlockRecord | null => parseRecord(readAll()[key]);

export function saveUnlocks(key: string, r: UnlockRecord): void {
  const all = readAll();
  delete all[key];
  all[key] = r;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PLAYERS))) delete all[old];
  writeJSON(KEY, all);
}

/** The player saved most recently on this device (null: the guest), or undefined when there is none. */
export function lastPlayer(): number | null | undefined {
  const key = Object.keys(readAll()).at(-1);
  if (key === 'guest') return null;
  const id = key?.startsWith('u') ? Number(key.slice(1)) : NaN;
  return Number.isInteger(id) ? id : undefined;
}
