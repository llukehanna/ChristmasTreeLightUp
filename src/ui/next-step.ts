import { ADVENT_DOORS, doorItem, doorState } from '../core/advent';
import { shortDay } from './format';

/**
 * The one next step the gift tag offers after a win (spec 2026-11-17): today's Daily when a new day began during the
 * session (the game otherwise opens on it), or, in Advent and signed in, the closed doors still shut.
 */
export interface NextStep {
  kind: 'daily' | 'catch-up';
  word: string;
  meta: string;
}

export interface NextStepInput {
  /** The local date, YYYY-MM-DD. */
  today: string;
  nowMs: number;
  /** This device has started today's Daily (the menu's "Played"). */
  dailyPlayed: boolean;
  signedIn: boolean;
  owns(id: string): boolean;
}

/** Today's door (1–24) while the calendar is live, December 1–24; else null. */
function adventDoor(today: string): number | null {
  const [, m, d] = today.split('-').map(Number);
  return m === 12 && d >= 1 && d <= ADVENT_DOORS ? d : null;
}

export function nextStep(i: NextStepInput): NextStep | null {
  const door = adventDoor(i.today);
  if (!i.dailyPlayed) {
    return door === null
      ? { kind: 'daily', word: "Today's Daily Tree", meta: shortDay(i.today) }
      : { kind: 'daily', word: `Advent · door ${door}`, meta: "Today's Daily" };
  }
  if (door === null || !i.signedIn) return null;
  let shut = 0;
  for (let d = 1; d <= ADVENT_DOORS; d++) if (doorState(d, i.today, i.nowMs, i.owns(doorItem(d).id)).state === 'catch-up') shut++;
  return shut > 0 ? { kind: 'catch-up', word: 'Advent', meta: `${shut} to catch up` } : null;
}
