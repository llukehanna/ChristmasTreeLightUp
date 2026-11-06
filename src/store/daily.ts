import { readJSON, writeJSON } from './storage';

/** The day (YYYY-MM-DD, local) of the last live Daily Tree this device started. */
const KEY = 'aglow.daily';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v);

/** The server started this device on `day`'s live Daily: from now that day's first tree is a random one. */
export function markDailyStarted(day: string): void {
  writeJSON(KEY, day);
}

/**
 * A fresh boot lands on the Daily Tree unless this device has already started today's (else a player who has played it
 * would land on a repeat). Blocked or corrupt storage lands on it: at worst a repeat, which the server knows.
 */
export function landsOnDaily(today: string): boolean {
  return readJSON(KEY, isDay) !== today;
}
