import { readJSON, removeKey, writeJSON } from './storage';

/** Home Alone mode (spec 2026-10-14): `true` while this browser is in the McCallister house; absent otherwise. */
const KEY = 'aglow.homeAlone';

export const loadHomeAlone = (): boolean => readJSON(KEY, (v): v is true => v === true) === true;

export function saveHomeAlone(on: boolean): void {
  if (on) writeJSON(KEY, true);
  else removeKey(KEY);
}
