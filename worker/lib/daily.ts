/**
 * The Daily Tree: one seed per calendar day, the same for everyone, derived from a server secret so it cannot be known
 * ahead of the day. A player's Daily is the tree of their own local date, which the server takes within a day of its
 * UTC date (liveDay), so the day's tree opens and closes on each player's own midnight.
 */
import { computeLighting } from '../../src/core/board.js';
import { GRID } from '../../src/core/mask.js';
import { GEN_VERSION, seededBoard } from '../../src/core/seeded.js';
import { fromBase64url, hmac } from './crypto.js';
import { DAY_MS, dayNumber, dayText } from './days.js';

/** The first Daily Tree. */
export const DAILY_FIRST_DAY = '2026-11-01';
/** Seeds tried for a day before giving up on finding one with light. */
export const DAILY_SEED_TRIES = 64;

/** True when the tree this seed makes has no tile lit at the start. The one definition of "dark". */
export function startsDark(seed: number, genVersion: number): boolean {
  const board = seededBoard(seed, genVersion);
  return board === null || computeLighting(GRID, board.bits).count === 0;
}

/** The day's k-th candidate: the first 32 bits of its HMAC (hmac gives base64url; 8 characters are 6 whole bytes). */
async function candidate(secret: string, day: number, k: number): Promise<number> {
  const bytes = fromBase64url((await hmac(secret, `daily:${dayText(day)}:${k}`)).slice(0, 8));
  return new DataView(bytes.buffer).getUint32(0);
}

/** The day's seed (a uint32): the first candidate whose tree starts with some light; the last one tried if none does. */
export async function dailySeed(secret: string, day: number): Promise<number> {
  let seed = 0;
  for (let k = 0; k < DAILY_SEED_TRIES; k++) {
    seed = await candidate(secret, day, k);
    if (!startsDark(seed, GEN_VERSION)) return seed;
  }
  return seed;
}

/** The day number of a YYYY-MM-DD string, when it is a real date on or after the first day and within a day of `nowMs`'s UTC date. */
export function liveDay(today: unknown, nowMs: number): number | null {
  const day = dayNumber(today);
  const first = dayNumber(DAILY_FIRST_DAY);
  if (day === null || first === null || day < first) return null;
  return Math.abs(day - Math.floor(nowMs / DAY_MS)) <= 1 ? day : null;
}

/** A day can be played until UTC midnight two days on. */
export const dailyClosesAt = (day: number): number => (day + 2) * DAY_MS;
