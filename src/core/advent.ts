/**
 * The Advent calendar (season two, Part C3): 24 doors, December 1–24. Each day's Daily Tree opens that day's door (its
 * catalogue item, goal `door1`…`door24`, unlocks); a past day's tree opens it too, any time after the day has closed.
 */
import { ITEMS, type ItemDef } from './catalogue';
import { localDay } from '../store/stats';

export const ADVENT_DOORS = 24;
const DAY_MS = 86_400_000;

/** The December the calendar shows: this year's in November and December, last year's from January to October. */
export function seasonYear(today: string): number {
  const [y, m] = today.split('-').map(Number);
  return m >= 11 ? y : y - 1;
}

/** Door `d`'s day (YYYY-MM-DD) in the season `today` is in. */
export const doorDay = (d: number, today: string): string => `${seasonYear(today)}-12-${String(d).padStart(2, '0')}`;

/**
 * When a day's tree can first be played as a past day's: UTC midnight two days on, when the day has ended everywhere.
 * The Worker's dailyClosesAt (worker/lib/daily.ts), which a past-day start is checked against.
 */
export function closesAt(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) / DAY_MS + 2) * DAY_MS;
}

const DOOR_ITEMS: readonly ItemDef[] = Array.from({ length: ADVENT_DOORS }, (_, i) => ITEMS.find((it) => it.goal === `door${i + 1}`) as ItemDef);

/** The catalogue item behind door `d` (1–24). */
export const doorItem = (d: number): ItemDef => DOOR_ITEMS[d - 1];

/**
 * - open: its item is owned (whatever the date: doors stay open)
 * - today: today's live Daily
 * - catch-up: a past day that has closed, to play as a past day's tree
 * - waiting: a past day still live somewhere; `opensOn` is the local date it can be played
 * - future: a day still ahead
 */
export type DoorState = 'open' | 'today' | 'catch-up' | 'waiting' | 'future';

/** Door `d` on the player's local date `today`, at `nowMs`, its item owned or not. */
export function doorState(d: number, today: string, nowMs: number, opened: boolean): { state: DoorState; opensOn?: string } {
  if (opened) return { state: 'open' };
  const day = doorDay(d, today);
  if (day === today) return { state: 'today' };
  if (day > today) return { state: 'future' };
  const closes = closesAt(day);
  return nowMs >= closes ? { state: 'catch-up' } : { state: 'waiting', opensOn: localDay(new Date(closes)) };
}
