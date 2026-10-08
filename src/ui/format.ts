import type { UnrankedReason } from '../api/types';

/** A ranked time as m:ss.t, rounded down so a time never reads faster than it was. */
export function formatMs(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Dec 3", or "Dec 3, 2025" in another year. */
export function formatDay(at: number, now: number): string {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === new Date(now).getFullYear() ? '' : `, ${d.getFullYear()}`}`;
}

/** "Today · 9:41 pm", "Yesterday · 10:15 pm" or "Dec 3 · 6:12 pm". */
export function formatWhen(at: number, now: number): string {
  const d = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const day = sameDay(d, today) ? 'Today' : sameDay(d, yesterday) ? 'Yesterday' : formatDay(at, now);
  const h = d.getHours();
  return `${day} · ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** A count as the tag and the sheets show it: digits with a comma from 1,000, and only ever a number. */
export const count = (n: number): string => Number(n).toLocaleString('en-US');

/** "1 run", "1,340 runs". `n` is coerced, so a server value can only ever paint as a number. */
export const plural = (n: number, word: string): string => {
  const v = Number(n);
  return `${v.toLocaleString('en-US')} ${v === 1 ? word : `${word}s`}`;
};

/** For text placed into HTML templates. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const initial = (name: string): string => esc((name.trim()[0] ?? '?').toUpperCase());

/** "Unranked: …" on the results tag and in Your games (spec §6). */
export const UNRANKED_TEXT: Readonly<Record<UnrankedReason | 'offline' | 'unverified', string>> = {
  anonymous: 'not signed in',
  paused: 'paused too long',
  too_fast: 'too fast',
  clock: "couldn't verify the clock",
  offline: 'offline',
  unverified: "couldn't verify this run",
};
