import { describe, expect, it } from 'vitest';
import { safeUploadName, slugify } from '../../../src/admin/names';
import { tagsFromBlob } from '../../../src/admin/tags';
import { firstProblem } from '../../../src/admin/validate';
import type { Station, Track } from '../../../src/radio/schema';

describe('slugify', () => {
  it('derives the station ids Plan 2 expects', () => {
    expect(slugify('Christmas Jazz')).toBe('christmas-jazz');
    expect(slugify('Christmas Classics')).toBe('christmas-classics');
    expect(slugify('  Crème Brûlée!! ')).toBe('creme-brulee');
  });
  it('never returns an empty id, and stays within 64 characters', () => {
    expect(slugify('!!!')).toBe('station');
    expect(slugify('a'.repeat(100))).toHaveLength(64);
    expect(slugify(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63)); // no trailing hyphen after the cut
  });
});

// The Worker's rule for the `name` query parameter (worker/routes/admin/upload.ts).
const serverAccepts = (n: string): boolean => n.length >= 1 && n.length <= 200 && n !== '.' && n !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(n);

describe('safeUploadName', () => {
  it('replaces slashes, backslashes and control characters with "-"', () => {
    expect(safeUploadName('AC/DC - Mistress\\for Christmas.mp3')).toBe('AC-DC - Mistress-for Christmas.mp3');
    expect(safeUploadName('Tab\there\u0000\u001f\u007f.mp3')).toBe('Tab-here---.mp3');
  });
  it('keeps unicode, apostrophes, commas and spaces', () => {
    const name = "Noël, it's a Christmas – Song 🎄.mp3";
    expect(safeUploadName(name)).toBe(name);
  });
  it('trims a 300-character name to 200 characters and keeps its extension', () => {
    const out = safeUploadName(`${'x'.repeat(296)}.mp3`);
    expect(out).toHaveLength(200);
    expect(out.endsWith('.mp3')).toBe(true);
    expect(serverAccepts(out)).toBe(true);
  });
  it('never splits a surrogate pair when trimming', () => {
    const out = safeUploadName(`${'🎄'.repeat(150)}.mp3`);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('🎄.mp3')).toBe(true);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });
  it('turns names the server refuses into ones it accepts', () => {
    for (const n of ['', '.', '..', '/', '\u0000']) expect(serverAccepts(safeUploadName(n))).toBe(true);
    expect(serverAccepts(safeUploadName('y'.repeat(300)))).toBe(true);
  });
});

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const syncsafe = (n: number): number[] => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
/** An ID3v2.3 text frame in ISO-8859-1. */
const frame = (id: string, text: string): number[] => [...ascii(id), ...be32(text.length + 1), 0, 0, 0, ...ascii(text)];
function id3v2(frames: number[][]): Uint8Array<ArrayBuffer> {
  const body = [...frames.flat(), ...new Array<number>(32).fill(0)];
  return Uint8Array.from([...ascii('ID3'), 3, 0, 0, ...syncsafe(body.length), ...body]);
}
/** Some bytes that look like the start of an MP3 frame stream. */
const audio = (n: number): Uint8Array<ArrayBuffer> => Uint8Array.from({ length: n }, (_, i) => (i % 4 === 0 ? 0xff : 0x90));

describe('tagsFromBlob', () => {
  it('reads the ID3v2 title and artist from the start of the file', async () => {
    const blob = new Blob([id3v2([frame('TIT2', 'Sleigh Ride'), frame('TPE1', 'Roddy Doyle Trio')]), audio(5000)], { type: 'audio/mpeg' });
    await expect(tagsFromBlob(blob, 'whatever.mp3')).resolves.toEqual({ title: 'Sleigh Ride', artist: 'Roddy Doyle Trio' });
  });
  it('reads an ID3v1 tag from the last 128 bytes', async () => {
    const field = (s: string): number[] => [...ascii(s), ...new Array<number>(30 - s.length).fill(0)];
    const v1 = Uint8Array.from([...ascii('TAG'), ...field('Blue Christmas'), ...field('Elvis Presley'), ...new Array<number>(65).fill(0)]);
    const blob = new Blob([audio(100_000), v1]);
    await expect(tagsFromBlob(blob, 'x.mp3')).resolves.toEqual({ title: 'Blue Christmas', artist: 'Elvis Presley' });
  });
  it('falls back to "Title - Artist" in the file name', async () => {
    await expect(tagsFromBlob(new Blob([audio(300)]), 'Linus And Lucy - Vince Guaraldi Trio.mp3')).resolves.toEqual({
      title: 'Linus And Lucy',
      artist: 'Vince Guaraldi Trio',
    });
    await expect(tagsFromBlob(new Blob([]), 'Silent Night.mp3')).resolves.toEqual({ title: 'Silent Night', artist: '' });
  });
});

const track = (over: Partial<Track> = {}): Track => ({
  id: 't1',
  url: 'https://aglow-music.example/tracks/christmas-jazz/abcd1234-a.mp3',
  title: 'Sleigh Ride',
  artist: '',
  credit: '',
  duration: 0,
  ...over,
});
const station = (over: Partial<Station> = {}): Station => ({ id: 'christmas-jazz', name: 'Christmas Jazz', description: '', tracks: [track()], ...over });

describe('firstProblem', () => {
  it('is null for a valid list', () => {
    expect(firstProblem([station(), station({ id: 'christmas-classics', name: 'Christmas Classics' })])).toBeNull();
  });
  it('names the station, the track and what is wrong', () => {
    const tracks = [track(), track({ id: 't2' }), track({ id: 't3', title: '   ' })];
    expect(firstProblem([station({ tracks })])).toEqual({
      message: 'Christmas Jazz, track 3: the title is empty. Every track needs a title.',
      stationId: 'christmas-jazz',
      track: 2,
      field: 'title',
    });
    expect(firstProblem([station({ tracks: [track({ credit: 'c'.repeat(501) })] })])?.message).toBe(
      'Christmas Jazz, track 1: the credit is longer than 500 characters.',
    );
  });
  it('points at station fields', () => {
    expect(firstProblem([station({ name: ' ' })])).toEqual({ message: 'Station "christmas-jazz": the name is empty.', stationId: 'christmas-jazz', field: 'name' });
    expect(firstProblem([station({ id: 'fireplace', name: 'Fireplace' })])?.message).toBe('Fireplace: the id "fireplace" is reserved. Delete this station and create it again with another name.');
  });
  it('catches duplicates', () => {
    expect(firstProblem([station(), station()])?.message).toBe('Two stations have the id "christmas-jazz".');
    expect(firstProblem([station({ tracks: [track(), track()] })])?.message).toBe('Christmas Jazz, track 2: the same track appears twice. Remove one of them.');
  });
});
