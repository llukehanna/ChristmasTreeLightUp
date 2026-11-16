import { UNRANKED_TEXT } from '../ui/format';
import type { UnrankedReason } from '../api/types';

export { formatMs as fmtTime, count as fmtCount, plural, esc } from '../ui/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Nov 3": the local day a run finished, as the mockup's `day`. */
export function fmtDay(at: number): string {
  const d = new Date(at);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "November 3", for "playing since". */
export function fmtLongDay(at: number): string {
  const d = new Date(at);
  return `${LONG_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "9:41 PM": the local time a run finished, as the mockup's `clock`. */
export function fmtClock(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Seconds to one decimal, rounded down like a time: "1.3". */
export const fmtSecs = (ms: number): string => (Math.floor(Math.abs(ms) / 100) / 10).toFixed(1);

/** "Unranked · paused too long"; a reason this browser doesn't know yet reads just "Unranked". */
export function unrankedLabel(reason: UnrankedReason): string {
  const why = Object.hasOwn(UNRANKED_TEXT, reason) ? UNRANKED_TEXT[reason] : null;
  return why ? `Unranked · ${why}` : 'Unranked';
}
