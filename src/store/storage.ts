/** All localStorage access goes through here: wrapped in try/catch and validated (spec §8). */
export function readJSON<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    return isValid(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota): keep playing without persistence.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Whether `key` holds anything at all in local (or session) storage; false when storage is unavailable. */
export function hasKey(key: string, store: 'local' | 'session' = 'local'): boolean {
  try {
    return (store === 'session' ? sessionStorage : localStorage).getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * Play data: a device holding any of these has played here before. Not 'aglow.look', which loadLook writes on a first
 * load.
 */
export const PLAYED_KEYS = ['aglow.stats', 'aglow.game', 'aglow.settings', 'aglow.radio'] as const;
/** "Save to leaderboard"'s round trip (sessionStorage, src/store/progress.ts): back from Google. */
export const RETURN_KEY = 'aglow.return';

/** This device has played here before: it holds play data, or this tab is back from Google mid-save. */
export function hasPlayed(): boolean {
  return PLAYED_KEYS.some((k) => hasKey(k)) || hasKey(RETURN_KEY, 'session');
}
