import { readJSON, writeJSON } from './storage';

export interface RadioSettings {
  v: 1;
  on: boolean;
  /** Station id, 'fireplace', 'embed', or null = follow the scene's suggestion. */
  source: string | null;
  embedUrl: string | null;
  volume: number;
  lightShow: boolean;
}

export const DEFAULT_RADIO: RadioSettings = { v: 1, on: true, source: null, embedUrl: null, volume: 0.7, lightShow: true };

const KEY = 'aglow.radio';

/** Older saves also carry `shuffle` (stations always shuffle now): it is tolerated, ignored and dropped on load. */
function isRadioSettings(v: unknown): v is RadioSettings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const strOrNull = (x: unknown) => x === null || (typeof x === 'string' && x.length <= 2000);
  return (
    o.v === 1 && typeof o.on === 'boolean' && strOrNull(o.source) && strOrNull(o.embedUrl) &&
    typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1 && typeof o.lightShow === 'boolean'
  );
}

export function loadRadioSettings(): RadioSettings {
  const s = readJSON(KEY, isRadioSettings);
  if (!s) return { ...DEFAULT_RADIO };
  return { v: 1, on: s.on, source: s.source, embedUrl: s.embedUrl, volume: s.volume, lightShow: s.lightShow };
}
export const saveRadioSettings = (s: RadioSettings): void => writeJSON(KEY, s);
