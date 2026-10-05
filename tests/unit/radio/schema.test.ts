import { describe, expect, it } from 'vitest';
import { parseStationsFile } from '../../../src/radio/schema';

const track = { id: 't1', url: 'https://x.public.blob.vercel-storage.com/a.mp3', title: 'Sleigh Ride', artist: 'Someone', credit: 'Uploaded by Luke', duration: 185 };
const file = { version: 3, stations: [{ id: 'christmas-jazz', name: 'Christmas Jazz', description: 'Curated by Luke', tracks: [track] }] };

describe('parseStationsFile', () => {
  it('accepts a valid file', () => {
    expect(parseStationsFile(file)).toEqual(file);
  });
  it('accepts site-relative URLs (bundled audio)', () => {
    const f = { ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: '/audio/a.m4a' }] }] };
    expect(parseStationsFile(f)).not.toBeNull();
  });
  it('accepts HTTPS Vercel Blob URL with query string', () => {
    const f = { ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: 'https://example.public.blob.vercel-storage.com/file.m4a?foo=bar' }] }] };
    expect(parseStationsFile(f)).not.toBeNull();
  });
  it('rejects bad ids, empty titles, http URLs and duplicate ids', () => {
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], id: 'Bad Id' }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, title: ' ' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: 'http://evil/a.mp3' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [file.stations[0], file.stations[0]] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [track, track] }] })).toBeNull();
  });
  it('rejects the ids the radio reserves for its own sources', () => {
    for (const id of ['music-box', 'fireplace', 'embed']) expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], id }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], id: 'music-box-2' }] })).not.toBeNull();
  });
  it('rejects problematic URLs', () => {
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: '//evil.com/a.mp3' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: '/\\evil.com/a.mp3' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: '/\t/evil.com/a.mp3' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: 'https://' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: 'javascript:alert(1)' }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, url: 'data:audio/mp3;base64,AAAA' }] }] })).toBeNull();
  });
  it('rejects invalid cover URLs', () => {
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], cover: 'http://evil/cover.jpg' }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, cover: 'javascript:alert(1)' }] }] })).toBeNull();
  });
  it('rejects non-integer version', () => {
    expect(parseStationsFile({ ...file, version: 3.5 })).toBeNull();
    expect(parseStationsFile({ ...file, version: '3' })).toBeNull();
  });
  it('rejects infinite or negative duration', () => {
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, duration: Infinity }] }] })).toBeNull();
    expect(parseStationsFile({ ...file, stations: [{ ...file.stations[0], tracks: [{ ...track, duration: -1 }] }] })).toBeNull();
  });
  it('rejects non-objects', () => {
    expect(parseStationsFile(null)).toBeNull();
    expect(parseStationsFile({ version: -1, stations: [] })).toBeNull();
  });
});
