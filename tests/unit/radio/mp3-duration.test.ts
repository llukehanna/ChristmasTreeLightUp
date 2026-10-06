import { describe, expect, it } from 'vitest';
import { id3v2Size, MP3_HEAD_BYTES, mp3Duration, mp3DurationFrom, type ReadRange } from '../../../src/radio/mp3-duration';

// Everything here is synthesized: ID3 headers, frame headers and zero padding. No real music.

/** An ID3v2.3 header declaring `body` bytes of tag data, followed by that many zeros. */
function id3(body: number, footer = false): Uint8Array {
  const out = new Uint8Array(10 + body);
  out.set([0x49, 0x44, 0x33, 3, 0, footer ? 0x10 : 0, (body >> 21) & 0x7f, (body >> 14) & 0x7f, (body >> 7) & 0x7f, body & 0x7f]);
  return out;
}

/** MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, stereo: 417-byte frames, 1152 samples each. */
const MPEG1_128 = [0xff, 0xfb, 0x90, 0x00];
/** MPEG-2 Layer III, 64 kbit/s, 22.05 kHz, mono (bit 7-6 = 11): 576 samples per frame. */
const MPEG2_MONO_64 = [0xff, 0xf3, 0x80, 0xc0];

/** A first frame (header, zeros, and optionally a Xing/Info tag after the side info), then a second header. */
function frames(header: number[], frameLen: number, xing?: { at: number; kind: 'Xing' | 'Info'; frames: number; flags?: number }): Uint8Array {
  const out = new Uint8Array(frameLen * 2 + 8);
  out.set(header, 0);
  out.set(header, frameLen);
  if (xing) {
    out.set([...xing.kind].map((c) => c.charCodeAt(0)), xing.at);
    const n = xing.frames;
    out.set([0, 0, 0, xing.flags ?? 1, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff], xing.at + 4);
  }
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('id3v2Size', () => {
  it('counts the header, the body and the footer', () => {
    expect(id3v2Size(id3(1000))).toBe(1010);
    expect(id3v2Size(id3(1000, true))).toBe(1020);
  });
  it('is 0 without a tag, with a bad version or with a non-syncsafe size', () => {
    expect(id3v2Size(new Uint8Array(20))).toBe(0);
    const bad = id3(10);
    bad[3] = 7;
    expect(id3v2Size(bad)).toBe(0);
    const wide = id3(10);
    wide[7] = 0x80;
    expect(id3v2Size(wide)).toBe(0);
    expect(id3v2Size(new Uint8Array(4))).toBe(0);
  });
});

describe('mp3Duration', () => {
  it('uses the Xing frame count: 2298 frames of 1152 samples at 44.1 kHz is 60 s', () => {
    const audio = frames(MPEG1_128, 417, { at: 4 + 32, kind: 'Xing', frames: 2298 });
    expect(mp3Duration(audio, 5_000_000)).toBe(60); // the byte count is ignored when the tag says
  });
  it('reads an Info tag too (CBR files written by LAME)', () => {
    const audio = frames(MPEG1_128, 417, { at: 4 + 32, kind: 'Info', frames: 1000 });
    expect(mp3Duration(audio, 1)).toBe(26); // 1000 × 1152 / 44100 = 26.1
  });
  it('finds the tag after the shorter MPEG-2 mono side info, and uses 576 samples per frame', () => {
    const audio = frames(MPEG2_MONO_64, 208, { at: 4 + 9, kind: 'Xing', frames: 3829 });
    expect(mp3Duration(audio, 10)).toBe(100); // 3829 × 576 / 22050 = 100.02
  });
  it('ignores a Xing tag that does not declare a frame count (flags bit 0 clear)', () => {
    const audio = frames(MPEG1_128, 417, { at: 4 + 32, kind: 'Xing', frames: 99999, flags: 2 });
    expect(mp3Duration(audio, 16_000 * 30)).toBe(30);
  });
  it('falls back to the first frame bitrate: 128 kbit/s is 16 000 bytes per second', () => {
    expect(mp3Duration(frames(MPEG1_128, 417), 16_000 * 60)).toBe(60);
    expect(mp3Duration(frames(MPEG1_128, 417), 16_000 * 215 + 7_000)).toBe(215);
  });
  it('rounds to whole seconds', () => {
    expect(mp3Duration(frames(MPEG1_128, 417), 16_000 * 215 + 9_000)).toBe(216);
  });
  it('skips junk before the first frame, but not a lone false sync', () => {
    const junk = concat(new Uint8Array(100), frames(MPEG1_128, 417));
    expect(mp3Duration(junk, 16_000 * 10 + 100)).toBe(10);
    // 0xFF 0xFB … with nothing valid where the next frame should be is not a frame.
    const lone = new Uint8Array(2000);
    lone.set(MPEG1_128, 10);
    expect(mp3Duration(lone, 16_000 * 10)).toBe(0);
  });
  it('is 0 when there is no frame, or the header is free-format, reserved or bad', () => {
    expect(mp3Duration(new Uint8Array(0), 100)).toBe(0);
    expect(mp3Duration(new Uint8Array(5000), 100_000)).toBe(0);
    for (const h of [
      [0xff, 0xfb, 0x00, 0x00], // free-format bitrate
      [0xff, 0xfb, 0xf0, 0x00], // reserved bitrate
      [0xff, 0xfb, 0x9c, 0x00], // reserved sample rate
      [0xff, 0xe9, 0x90, 0x00], // reserved version (01)
      [0xff, 0xf9, 0x90, 0x00], // reserved layer (00)
    ]) {
      expect(mp3Duration(frames(h, 417), 100_000)).toBe(0);
    }
  });
  it('is 0 for a zero or negative audio size', () => {
    expect(mp3Duration(frames(MPEG1_128, 417), 0)).toBe(0);
    expect(mp3Duration(frames(MPEG1_128, 417), -5)).toBe(0);
  });
});

/** A file made of parts, readable by byte range like the admin's File or a Range fetch. */
function reader(file: Uint8Array): { read: ReadRange; reads: [number, number][] } {
  const reads: [number, number][] = [];
  return { reads, read: async (s, e) => (reads.push([s, e]), file.slice(s, Math.min(e, file.length))) };
}

describe('mp3DurationFrom', () => {
  it('skips a small ID3v2 tag inside the head with one read', async () => {
    const file = concat(id3(1000), frames(MPEG1_128, 417), new Uint8Array(MP3_HEAD_BYTES)); // a file longer than the head
    const { read, reads } = reader(file);
    // The size claims 60 s of audio after the tag.
    expect(await mp3DurationFrom(read, 1010 + 16_000 * 60)).toBe(60);
    expect(reads).toEqual([[0, MP3_HEAD_BYTES]]);
  });
  it('reads the audio separately behind a tag bigger than the head (cover art)', async () => {
    const tag = id3(300_000);
    const file = concat(tag, frames(MPEG1_128, 417, { at: 4 + 32, kind: 'Xing', frames: 5000 }));
    const { read, reads } = reader(file);
    expect(await mp3DurationFrom(read, file.length + 5_000_000)).toBe(131); // 5000 × 1152 / 44100 = 130.6
    expect(reads).toEqual([
      [0, MP3_HEAD_BYTES],
      [300_010, 300_010 + MP3_HEAD_BYTES],
    ]);
  });
  it('works on a file with no tag at all, and a tiny one', async () => {
    const file = frames(MPEG1_128, 417);
    expect(await mp3DurationFrom(reader(file).read, 16_000 * 20)).toBe(20);
    expect(await mp3DurationFrom(reader(file).read, 0)).toBe(0);
    expect(await mp3DurationFrom(reader(new Uint8Array(3)).read, 3)).toBe(0);
  });
  it('is 0 when a tag claims more than the file, or a read fails', async () => {
    const file = id3(1_000_000);
    expect(await mp3DurationFrom(reader(file).read, file.length)).toBe(0);
    expect(await mp3DurationFrom(() => Promise.reject(new Error('network')), 1_000_000)).toBe(0);
  });
});
