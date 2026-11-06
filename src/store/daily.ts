import type { DailyInfo } from '../api/types';
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

/**
 * The Daily the server just started, as this device plays it. When the server knew the player (`signedIn`: the start
 * came back with no claim), its `repeat` is final: the device's mark may be a guest go never finished, or another
 * account's. For a guest, whom the server can't know (decision 5), it is a repeat when this device had already started
 * that day's live Daily before this start. A live day's start marks the device either way; a past day's tree is never a
 * repeat and marks nothing.
 */
export function dailyStart(daily: DailyInfo, signedIn: boolean): DailyInfo {
  if (daily.past) return daily;
  const known = !signedIn && readJSON(KEY, isDay) === daily.day;
  markDailyStarted(daily.day);
  return known && !daily.repeat ? { ...daily, repeat: true } : daily;
}
