import { SECRET_ID } from '../radio/ids.js';
import { STATION_ID, isUrl, parseStation, parseStationsFile, type Station } from '../radio/schema.js';

export type Field = 'name' | 'description' | 'title' | 'artist' | 'credit';

/** The first thing the Worker would refuse, in plain words, and where it is (a track index counts from 0). */
export interface Problem {
  message: string;
  stationId: string;
  track?: number;
  field?: Field;
}

const MAX_STATIONS = 20;
const MAX_TRACKS = 500;

/** Mirrors parseStationsFile (src/radio/schema.ts), but says which station, which track and what is wrong. */
export function firstProblem(stations: readonly Station[]): Problem | null {
  if (stations.length > MAX_STATIONS) {
    return { message: `There can be at most ${MAX_STATIONS} stations. Delete one before saving.`, stationId: stations[MAX_STATIONS].id };
  }
  const ids = new Set<string>();
  for (const s of stations) {
    const label = s.name.trim() || `Station "${s.id}"`;
    const at = (message: string, field?: Field): Problem => ({ message: `${label}: ${message}`, stationId: s.id, ...(field ? { field } : {}) });
    if (!STATION_ID.test(s.id)) return at(`the id "${s.id}" is not valid. Delete this station and create it again.`);
    // A well-formed id the schema still refuses is one of the radio's own sources.
    if (!parseStation({ id: s.id, name: 'x', description: '', tracks: [] })) {
      return at(`the id "${s.id}" is reserved. Delete this station and create it again with another name.`);
    }
    if (ids.has(s.id)) return { message: `Two stations have the id "${s.id}".`, stationId: s.id };
    ids.add(s.id);
    if (s.name.trim() === '') return at('the name is empty.', 'name');
    if (s.name.length > 60) return at('the name is longer than 60 characters.', 'name');
    if (s.description.length > 200) return at('the description is longer than 200 characters.', 'description');
    if (s.cover !== undefined && !isUrl(s.cover)) return at('the cover link is not valid. Upload the cover again.');
    if (s.winSound !== undefined) {
      if (s.id !== SECRET_ID) return at('only the Secret station can have a win ad-lib.');
      if (!isUrl(s.winSound)) return at('the win ad-lib link is not valid. Upload it again.');
    }
    if (s.tracks.length > MAX_TRACKS) return at(`a station can have at most ${MAX_TRACKS} tracks.`);
    const trackIds = new Set<string>();
    for (const [i, t] of s.tracks.entries()) {
      const fault = (message: string, field?: Field): Problem => ({
        message: `${label}, track ${i + 1}: ${message}`,
        stationId: s.id,
        track: i,
        ...(field ? { field } : {}),
      });
      if (trackIds.has(t.id)) return fault('the same track appears twice. Remove one of them.');
      trackIds.add(t.id);
      if (t.title.trim() === '') return fault('the title is empty. Every track needs a title.', 'title');
      if (t.title.length > 200) return fault('the title is longer than 200 characters.', 'title');
      if (t.artist.length > 200) return fault('the artist is longer than 200 characters.', 'artist');
      if (t.credit.length > 500) return fault('the credit is longer than 500 characters.', 'credit');
      if (t.id === '' || t.id.length > 64 || !isUrl(t.url)) return fault('the file link is not valid. Remove the track and upload it again.');
      if (!Number.isFinite(t.duration) || t.duration < 0) return fault('the length is not valid. Remove the track and upload it again.');
      if (t.cover !== undefined && !isUrl(t.cover)) return fault('the cover link is not valid.');
    }
  }
  if (!parseStationsFile({ version: 0, stations })) {
    return { message: 'Some station or track fields are invalid.', stationId: stations[0]?.id ?? '' };
  }
  return null;
}
