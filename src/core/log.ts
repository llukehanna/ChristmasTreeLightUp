import type { Grid } from './mask';

/** A tile index (an accepted tap), 'p' (pause) or 'r' (resume). */
export type LogAction = number | 'p' | 'r';

export interface LogEntry {
  /** Integer ms since the game's local start (Date.now() − startEpoch), continuous across reloads. */
  t: number;
  a: LogAction;
}

export const MAX_LOG_ENTRIES = 5000;
export const MAX_LOG_MS = 86_400_000;

/**
 * A log from untrusted JSON, or null: at most 5,000 entries; integer times from 0 to one day that never go backwards;
 * taps on tiles of `grid` only; pauses and resumes strictly alternating, starting with a pause.
 */
export function parseLog(value: unknown, grid: Grid): LogEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOG_ENTRIES) return null;
  const out: LogEntry[] = [];
  let last = 0;
  let paused = false;
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { t, a } = entry as Record<string, unknown>;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < last || t > MAX_LOG_MS) return null;
    if (a === 'p' || a === 'r') {
      if ((a === 'p') === paused) return null;
      paused = a === 'p';
    } else if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a >= grid.cells.length || !grid.cells[a]) {
      return null;
    }
    last = t;
    out.push({ t, a });
  }
  return out;
}

/** Whether a log's last pause or resume is a pause. */
export function endsPaused(log: readonly LogEntry[]): boolean {
  for (let k = log.length - 1; k >= 0; k--) {
    if (log[k].a === 'p') return true;
    if (log[k].a === 'r') return false;
  }
  return false;
}

/**
 * The browser's recorder. Times come from the caller (log ms), so it stays pure. Taps while paused are never logged
 * (the server would refuse them), a pause or resume only when the state changes, and times never go backwards.
 * Past MAX_LOG_ENTRIES nothing more is kept, and `overflowed` says so: such a run can't verify, so it isn't sent.
 */
export class GameLog {
  readonly entries: LogEntry[];
  private pausedNow: boolean;
  private dropped = false;

  constructor(entries: readonly LogEntry[] = []) {
    this.entries = [...entries];
    this.pausedNow = endsPaused(entries);
  }

  get paused(): boolean {
    return this.pausedNow;
  }

  /** An entry was dropped at the cap: the log no longer matches the game. */
  get overflowed(): boolean {
    return this.dropped;
  }

  tap(t: number, tile: number): void {
    if (!this.pausedNow) this.push(t, tile);
  }

  pause(t: number): void {
    if (this.pausedNow) return;
    this.pausedNow = true;
    this.push(t, 'p');
  }

  resume(t: number): void {
    if (!this.pausedNow) return;
    this.pausedNow = false;
    this.push(t, 'r');
  }

  private push(t: number, a: LogAction): void {
    if (this.entries.length >= MAX_LOG_ENTRIES) {
      this.dropped = true;
      return;
    }
    const last = this.entries.length ? this.entries[this.entries.length - 1].t : 0;
    this.entries.push({ t: Math.min(MAX_LOG_MS, Math.max(last, Math.round(t))), a });
  }
}
