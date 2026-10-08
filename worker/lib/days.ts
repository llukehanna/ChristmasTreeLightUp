/**
 * Calendar days as whole numbers (days since 1970-01-01) for streaks and the history import (spec 2026-10-08 §5).
 * A player's local day uses the offset their browser gives (Date#getTimezoneOffset: UTC minus local, in minutes).
 */
export const DAY_MS = 86_400_000;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-08" → its day number; null unless it is a real date written exactly that way. */
export function dayNumber(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const m = DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t / DAY_MS : null;
}

/** A day number as YYYY-MM-DD. */
export const dayText = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Every real zone is within 14 hours of UTC. */
export const isTzOffset = (v: unknown): v is number => Number.isInteger(v) && Math.abs(v as number) <= 840;

/** The local day, in the zone `tz`, of an epoch-ms instant. */
export const localDayOf = (at: number, tz: number): number => Math.floor((at - tz * 60_000) / DAY_MS);

/** Epoch ms of the local midnight that starts `day` in the zone `tz`. */
export const localMidnight = (day: number, tz: number): number => day * DAY_MS + tz * 60_000;

export interface Streaks {
  streak: number;
  longestStreak: number;
}

/**
 * From distinct days in ascending order: the run of consecutive days ending at the last one, if that is today or
 * yesterday (else 0), and the longest run.
 */
export function streaksOf(days: readonly number[], today: number): Streaks {
  let longest = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  const last = days.at(-1);
  return { streak: last !== undefined && last >= today - 1 ? run : 0, longestStreak: longest };
}
