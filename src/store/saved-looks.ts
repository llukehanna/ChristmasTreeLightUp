import { parseLook, type Look } from './look';
import { readJSON, writeJSON } from './storage';

/** One of the wardrobe's three saved looks (plan Decision 11): the player's whole look, under a short name. */
export interface SavedLook {
  name: string;
  look: Look;
}

const KEY = 'aglow.looks';
const SLOTS = 3;
const NAME_MAX = 16;

const nameOf = (raw: string, slot: number): string => raw.trim().slice(0, NAME_MAX) || `Look ${slot + 1}`;

/** The three slots, in order; an empty or unreadable one is null. Each look reads field by field (parseLook). */
export function loadLooks(): (SavedLook | null)[] {
  const raw = readJSON(KEY, Array.isArray) ?? [];
  return Array.from({ length: SLOTS }, (_, i) => {
    const o: unknown = raw[i];
    if (typeof o !== 'object' || o === null) return null;
    const { name, look } = o as Record<string, unknown>;
    return typeof name === 'string' ? { name: nameOf(name, i), look: parseLook(look) } : null;
  });
}

export function saveLookIn(slot: 0 | 1 | 2, s: SavedLook): void {
  const looks = loadLooks();
  looks[slot] = { name: nameOf(s.name, slot), look: s.look };
  writeJSON(KEY, looks);
}
