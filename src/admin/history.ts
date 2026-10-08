import { HISTORY_FIRST_DAY, MAX_IMPORT_MS, MAX_IMPORT_RUNS, MAX_STREAK_DAYS, MIN_IMPORT_BEST_SECONDS, type ImportRequest } from '../api/types.js';
import { formatTime } from '../core/score.js';
import type { Stats } from '../store/stats.js';
import { readJSON, writeJSON } from '../store/storage.js';
import { formatMs, plural } from '../ui/format.js';

/** The import card's fields as typed (spec 2026-10-08 §6.1). */
export interface ImportFields {
  solved: string;
  best: string;
  average: string;
  streak: string;
  longest: string;
  lastDay: string;
}

/** What this device's stats suggest, and the exact average behind the rounded text. */
export interface ImportDefaults {
  fields: ImportFields;
  averageMs: number;
}

const CLOCK = /^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/;
const WHOLE = /^\d{1,6}$/;

/** "m:ss" or "m:ss.t" (up to milliseconds) → ms; null for anything else. */
export function parseClock(text: string): number | null {
  const m = CLOCK.exec(text.trim());
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] ?? '').padEnd(3, '0'));
}

/** The form as this device's stats fill it, or null when this browser has no solved game to import. */
export function importDefaults(s: Stats): ImportDefaults | null {
  if (s.solved < 1 || s.bestSeconds === null || s.lastSolvedDay === null) return null;
  const averageMs = Math.round((s.totalSeconds * 1000) / s.solved);
  return {
    averageMs,
    fields: {
      solved: String(s.solved),
      best: formatTime(s.bestSeconds),
      average: formatMs(averageMs),
      streak: String(Math.max(1, s.streak)),
      longest: String(Math.max(1, s.longestStreak, s.streak)),
      lastDay: s.lastSolvedDay,
    },
  };
}

const whole = (text: string): number => (WHOLE.test(text.trim()) ? Number(text.trim()) : Number.NaN);

/** The request the card sends, or what is wrong with the form (the server checks it all again). */
export function importRequest(f: ImportFields, d: ImportDefaults, importId: string, tz: number, today: string): ImportRequest | string {
  const solved = whole(f.solved);
  if (!(solved >= 1 && solved <= MAX_IMPORT_RUNS)) return 'Games solved must be a whole number from 1 to 2,000.';
  const bestMs = parseClock(f.best);
  if (bestMs === null || bestMs % 1000 !== 0 || bestMs < MIN_IMPORT_BEST_SECONDS * 1000 || bestMs > MAX_IMPORT_MS) return 'Best time must be m:ss, from 0:05 to 60:00.';
  // One game: its time is the average. Otherwise the typed average, or the exact one behind untouched text.
  const averageMs = solved === 1 ? bestMs : f.average.trim() === d.fields.average ? d.averageMs : parseClock(f.average);
  if (averageMs === null || averageMs > MAX_IMPORT_MS) return 'Average time must be m:ss.t, at most 60:00.';
  if (averageMs < bestMs) return "Average time can't be faster than the best time.";
  const streak = whole(f.streak);
  const longest = whole(f.longest);
  if (!(streak >= 1 && longest >= streak && longest <= MAX_STREAK_DAYS)) return 'Streaks are whole days from 1, and the longest is at least the current one.';
  const lastDay = f.lastDay.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || lastDay < HISTORY_FIRST_DAY || lastDay > today) return 'Last solved day must be a date from 2026-09-29 to today.';
  return { importId, solved, bestSeconds: bestMs / 1000, averageMs, streak, longestStreak: longest, lastSolvedDay: lastDay, tz };
}

/** What the card tells the admin an import will create, from the request it would send. */
export function importPreview(r: ImportRequest): string {
  return `Will add ${plural(r.solved, 'run')}: best ${formatMs(r.bestSeconds * 1000)}, average ${formatMs(r.averageMs)}, streak ${plural(r.streak, 'day')}, longest streak ${plural(r.longestStreak, 'day')}, last played ${r.lastSolvedDay}.`;
}

const MARK_KEY = 'aglow.historyImport';

/** This device's import: the id is made and saved before the first send, so a resend can never add the runs twice. */
export interface ImportMark {
  v: 1;
  importId: string;
  done: boolean;
  added: number;
}

const isMark = (v: unknown): v is ImportMark => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.v === 1 && typeof o.importId === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(o.importId) && typeof o.done === 'boolean' && Number.isInteger(o.added) && (o.added as number) >= 0;
};

export const readMark = (): ImportMark | null => readJSON(MARK_KEY, isMark);

/** 16 random bytes, base64url: 22 characters. */
export function newImportId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The mark to send with: this device's own, or a new one, saved before the request goes out. */
export function pendingMark(newId: () => string = newImportId): ImportMark {
  const kept = readMark();
  if (kept) return kept;
  const fresh: ImportMark = { v: 1, importId: newId(), done: false, added: 0 };
  writeJSON(MARK_KEY, fresh);
  return fresh;
}

export function markDone(m: ImportMark, added: number): ImportMark {
  const done: ImportMark = { ...m, done: true, added };
  writeJSON(MARK_KEY, done);
  return done;
}
