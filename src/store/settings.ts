import { readJSON, writeJSON } from './storage';

export interface Settings {
  v: 2;
  effectsVolume: number;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = { v: 2, effectsVolume: 0.8, haptics: true };

const KEY = 'aglow.settings';

/** A v1 record also held the scene and path style, which now live in the look (src/store/look.ts); they are dropped. */
function isSettings(v: unknown): v is Pick<Settings, 'effectsVolume' | 'haptics'> {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.v === 1 || o.v === 2) &&
    typeof o.effectsVolume === 'number' && o.effectsVolume >= 0 && o.effectsVolume <= 1 &&
    typeof o.haptics === 'boolean'
  );
}

export function loadSettings(): Settings {
  const s = readJSON(KEY, isSettings);
  return s ? { v: 2, effectsVolume: s.effectsVolume, haptics: s.haptics } : { ...DEFAULT_SETTINGS };
}
export const saveSettings = (s: Settings): void => writeJSON(KEY, s);
