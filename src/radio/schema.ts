import { FIREPLACE_ID, MUSIC_BOX_ID } from './ids.js';

export interface Track {
  id: string;
  url: string;
  title: string;
  artist: string;
  credit: string;
  /** Seconds; 0 if unknown. */
  duration: number;
  cover?: string;
}

export interface Station {
  id: string;
  name: string;
  description: string;
  cover?: string;
  tracks: Track[];
}

export interface StationsFile {
  version: number;
  stations: Station[];
}

/** Station ids: lower-case letters, digits and hyphens, starting with a letter or digit, up to 64 characters. */
export const STATION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Source ids the radio itself uses: a station with one of these would be unreachable or shadow a built-in source. */
const RESERVED_IDS: ReadonlySet<string> = new Set([MUSIC_BOX_ID, FIREPLACE_ID, 'embed']);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** https URLs or site-relative paths only. */
export const isUrl = (v: unknown): v is string => {
  if (!isStr(v, 2000)) return false;

  // Check for control characters including backslash
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return false;

  if (v.startsWith('/') && !v.startsWith('//')) {
    // Relative URL: must resolve to https://x.invalid origin
    try {
      const url = new URL(v, 'https://x.invalid');
      return url.origin === 'https://x.invalid';
    } catch {
      return false;
    }
  } else if (v.startsWith('https://')) {
    // Absolute HTTPS URL: must have non-empty hostname
    try {
      const url = new URL(v);
      return url.protocol === 'https:' && url.hostname !== '';
    } catch {
      return false;
    }
  }

  return false;
};
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseTrack(v: unknown): Track | null {
  const o = obj(v);
  if (!o) return null;
  const { id, url, title, artist, credit, duration, cover } = o;
  if (!isStr(id, 64) || id === '' || !isUrl(url) || !isStr(title, 200) || title.trim() === '') return null;
  if (!isStr(artist, 200) || !isStr(credit, 500) || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;
  if (cover !== undefined && !isUrl(cover)) return null;
  return { id, url, title, artist, credit, duration, ...(cover !== undefined ? { cover } : {}) };
}

export function parseStation(v: unknown): Station | null {
  const o = obj(v);
  if (!o) return null;
  const { id, name, description, cover, tracks } = o;
  if (!isStr(id, 64) || !STATION_ID.test(id) || RESERVED_IDS.has(id) || !isStr(name, 60) || name.trim() === '' || !isStr(description, 200)) return null;
  if (cover !== undefined && !isUrl(cover)) return null;
  if (!Array.isArray(tracks) || tracks.length > 500) return null;
  const parsed: Track[] = [];
  const ids = new Set<string>();
  for (const t of tracks) {
    const p = parseTrack(t);
    if (!p || ids.has(p.id)) return null;
    ids.add(p.id);
    parsed.push(p);
  }
  return { id, name, description, ...(cover !== undefined ? { cover } : {}), tracks: parsed };
}

export function parseStationsFile(v: unknown): StationsFile | null {
  const o = obj(v);
  if (!o || !Number.isInteger(o.version) || (o.version as number) < 0 || !Array.isArray(o.stations) || o.stations.length > 20) return null;
  const stations: Station[] = [];
  const ids = new Set<string>();
  for (const s of o.stations) {
    const p = parseStation(s);
    if (!p || ids.has(p.id)) return null;
    ids.add(p.id);
    stations.push(p);
  }
  return { version: o.version as number, stations };
}
