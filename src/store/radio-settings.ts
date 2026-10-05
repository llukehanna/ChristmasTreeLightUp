import { readJSON, writeJSON } from './storage';

export interface RadioSettings {
  v: 1;
  on: boolean;
  /** Station id, 'fireplace', 'embed', or null = follow the scene's suggestion. */
  source: string | null;
  embedUrl: string | null;
  volume: number;
  shuffle: boolean;
  lightShow: boolean;
}

export const DEFAULT_RADIO: RadioSettings = { v: 1, on: true, source: null, embedUrl: null, volume: 0.7, shuffle: true, lightShow: true };

const KEY = 'aglow.radio';

function isRadioSettings(v: unknown): v is RadioSettings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const strOrNull = (x: unknown) => x === null || (typeof x === 'string' && x.length <= 2000);
  return (
    o.v === 1 && typeof o.on === 'boolean' && strOrNull(o.source) && strOrNull(o.embedUrl) &&
    typeof o.volume === 'number' && o.volume >= 0 && o.volume <= 1 && typeof o.shuffle === 'boolean' && typeof o.lightShow === 'boolean'
  );
}

export const loadRadioSettings = (): RadioSettings => readJSON(KEY, isRadioSettings) ?? { ...DEFAULT_RADIO };
export const saveRadioSettings = (s: RadioSettings): void => writeJSON(KEY, s);
