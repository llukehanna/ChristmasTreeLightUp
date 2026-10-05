import { expect, it } from 'vitest';
import { decodeText, readId3v1, readId3v2, tagsFromFilename, trackTags } from '../../../dev/id3';

const bytes = (...parts: (number[] | Uint8Array | string)[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const utf16le = (s: string) => [0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])];
const utf16be = (s: string) => [...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]);
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

/** One text frame: encoding byte + payload. */
function frame(major: 3 | 4, id: string, enc: number, payload: number[]): Uint8Array {
  const body = [enc, ...payload];
  return bytes(id, major === 4 ? syncsafe(body.length) : be32(body.length), [0, 0], body);
}
function tag(major: 3 | 4, frames: Uint8Array[], padding = 16): Uint8Array {
  const body = bytes(...frames, new Array<number>(padding).fill(0));
  return bytes('ID3', [major, 0, 0], syncsafe(body.length), body, [0xff, 0xfb, 0x90, 0x00]);
}

it('reads ID3v2.3 title and artist in ISO-8859-1 and UTF-16 with a BOM', () => {
  const t = tag(3, [frame(3, 'TALB', 0, [...'Album'].map((c) => c.charCodeAt(0))), frame(3, 'TIT2', 0, [...'Sleigh Ride'].map((c) => c.charCodeAt(0))), frame(3, 'TPE1', 1, utf16le('Grâce Trio'))]);
  expect(readId3v2(t)).toEqual({ title: 'Sleigh Ride', artist: 'Grâce Trio' });
});

it('reads ID3v2.4 UTF-8 and UTF-16BE frames with syncsafe sizes, joining several values', () => {
  const long = 'x'.repeat(200); // a frame over 127 bytes: its syncsafe size differs from a plain integer
  const t = tag(4, [frame(4, 'TXXX', 3, utf8(long)), frame(4, 'TIT2', 3, utf8('The First Noël')), frame(4, 'TPE1', 2, [...utf16be('Bing Crosby'), 0, 0, ...utf16be('Carol Richards')])]);
  expect(readId3v2(t)).toEqual({ title: 'The First Noël', artist: 'Bing Crosby, Carol Richards' });
});

it('strips terminators, and returns what it has from a truncated or missing tag', () => {
  expect(decodeText(Uint8Array.from([0, 0x41, 0x42, 0]))).toBe('AB');
  expect(decodeText(Uint8Array.from([1, ...utf16le('Hi'), 0, 0]))).toBe('Hi');
  const t = tag(3, [frame(3, 'TIT2', 0, [...'Only Title'].map((c) => c.charCodeAt(0))), frame(3, 'APIC', 0, new Array<number>(500).fill(7)), frame(3, 'TPE1', 0, [0x41])]);
  expect(readId3v2(t.subarray(0, 200))).toEqual({ title: 'Only Title' }); // cut inside the cover art
  expect(readId3v2(bytes([0xff, 0xfb, 0x90, 0x00], new Array<number>(20).fill(0)))).toEqual({});
});

it('falls back to ID3v1', () => {
  const field = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(new Array<number>(30 - s.length).fill(0));
  const v1 = bytes(new Array<number>(50).fill(1), 'TAG', field('Blue Christmas'), field('Elvis Presley'), new Array<number>(65).fill(0));
  expect(readId3v1(v1)).toEqual({ title: 'Blue Christmas', artist: 'Elvis Presley' });
  expect(trackTags('whatever.mp3', new Uint8Array(10), v1)).toEqual({ title: 'Blue Christmas', artist: 'Elvis Presley' });
});

it('splits the file name on " - " when there are no tags', () => {
  expect(tagsFromFilename('Sleigh Ride - Roddy Doyle Trio.mp3')).toEqual({ title: 'Sleigh Ride', artist: 'Roddy Doyle Trio' });
  expect(tagsFromFilename('Linus And Lucy.mp3')).toEqual({ title: 'Linus And Lucy', artist: '' });
  // A version note is not an artist.
  expect(tagsFromFilename('Winter Wonderland - Remastered 2006.mp3')).toEqual({ title: 'Winter Wonderland - Remastered 2006', artist: '' });
  expect(trackTags('Sleigh Ride - Roddy Doyle Trio.mp3', new Uint8Array(0), new Uint8Array(0))).toEqual({ title: 'Sleigh Ride', artist: 'Roddy Doyle Trio' });
});

it('prefers ID3v2 over the file name, field by field', () => {
  const t = tag(3, [frame(3, 'TPE1', 0, [...'The Ronettes'].map((c) => c.charCodeAt(0)))]);
  expect(trackTags('Sleigh Ride - Somebody.mp3', t, new Uint8Array(0))).toEqual({ title: 'Sleigh Ride', artist: 'The Ronettes' });
});
