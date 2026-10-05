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

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** https URLs or site-relative paths only. */
const isUrl = (v: unknown): v is string => isStr(v, 2000) && (v.startsWith('https://') || (v.startsWith('/') && !v.startsWith('//')));
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseTrack(v: unknown): Track | null {
  const o = obj(v);
  if (!o) return null;
  const { id, url, title, artist, credit, duration, cover } = o;
  if (!isStr(id, 64) || id === '' || !isUrl(url) || !isStr(title, 200) || title.trim() === '') return null;
  if (!isStr(artist, 200) || !isStr(credit, 500) || typeof duration !== 'number' || !(duration >= 0)) return null;
  if (cover !== undefined && !isUrl(cover)) return null;
  return { id, url, title, artist, credit, duration, ...(cover !== undefined ? { cover } : {}) };
}

export function parseStation(v: unknown): Station | null {
  const o = obj(v);
  if (!o) return null;
  const { id, name, description, cover, tracks } = o;
  if (!isStr(id, 64) || !ID.test(id) || !isStr(name, 60) || name.trim() === '' || !isStr(description, 200)) return null;
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
