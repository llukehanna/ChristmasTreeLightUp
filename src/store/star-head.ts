import { readJSON, removeKey, writeJSON } from './storage';

/** The star-head egg (2026-10-08): `true` while Luke's head tops the tree in this browser; absent for the star. */
const KEY = 'aglow.starHead';

export const loadStarHead = (): boolean => readJSON(KEY, (v): v is true => v === true) === true;

export function saveStarHead(on: boolean): void {
  if (on) writeJSON(KEY, true);
  else removeKey(KEY);
}
