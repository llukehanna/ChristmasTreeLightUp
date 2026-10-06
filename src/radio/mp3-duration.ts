/**
 * MP3 length from the file's bytes, so the admin never has to load audio in the browser (a hidden tab throttles
 * media loading, which used to save every duration as 0). Pure functions over bytes; the game never imports this.
 *
 * Prefers the Xing/Info (or VBRI) frame count in the first MPEG frame (exact for VBR), and falls back to a CBR
 * estimate from the first frame's bitrate and the audio's size. Anything it can't make sense of is 0.
 */

/** How much it reads at the start of the file, and again after a large ID3v2 tag. */
export const MP3_HEAD_BYTES = 64 * 1024;
/** A frame header is searched for this far past the ID3v2 tag (junk or padding some encoders leave). */
const SCAN_BYTES = 4096;

/** Bitrates in kbit/s by [MPEG-1 ? 0 : 1][layer 1..3][index 1..14]. */
const BITRATES: readonly (readonly (readonly number[])[])[] = [
  [[], [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]],
  [[], [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]],
];
/** Sample rates by version (MPEG-1, 2, 2.5) and index. */
const SAMPLE_RATES: readonly (readonly number[])[] = [
  [44100, 48000, 32000],
  [22050, 24000, 16000],
  [11025, 12000, 8000],
];

interface Frame {
  /** Offset of the frame header in the buffer. */
  at: number;
  bitrate: number;
  sampleRate: number;
  samplesPerFrame: number;
  /** Bytes in this frame. */
  length: number;
  mpeg1: boolean;
  mono: boolean;
}

/** The frame header at `o`, or null when those four bytes are not a usable MPEG audio header. */
function frameAt(b: Uint8Array, o: number): Frame | null {
  if (o < 0 || o + 4 > b.length) return null;
  if (b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const v = (b[o + 1] >> 3) & 3; // 0: MPEG-2.5, 1: reserved, 2: MPEG-2, 3: MPEG-1
  const layer = 4 - ((b[o + 1] >> 1) & 3); // 1..3 (4: reserved)
  const bitrateIdx = b[o + 2] >> 4;
  const srIdx = (b[o + 2] >> 2) & 3;
  if (v === 1 || layer > 3 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null;
  const mpeg1 = v === 3;
  const bitrate = BITRATES[mpeg1 ? 0 : 1][layer][bitrateIdx] * 1000;
  const sampleRate = SAMPLE_RATES[mpeg1 ? 0 : v === 2 ? 1 : 2][srIdx];
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 || mpeg1 ? 1152 : 576;
  const padding = (b[o + 2] >> 1) & 1;
  const length = layer === 1 ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4 : Math.floor((samplesPerFrame / 8 * bitrate) / sampleRate) + padding;
  return { at: o, bitrate, sampleRate, samplesPerFrame, length, mpeg1, mono: ((b[o + 3] >> 6) & 3) === 3 };
}

const be32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const hasTag = (b: Uint8Array, o: number, s: string): boolean => {
  if (o < 0 || o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
};

/** The frame count a Xing/Info or VBRI header in frame `f` declares, or 0 when it has none. */
function declaredFrames(b: Uint8Array, f: Frame): number {
  const side = f.mpeg1 ? (f.mono ? 17 : 32) : f.mono ? 9 : 17;
  // Right after the side info; a frame with a CRC has 2 more bytes in front of it.
  for (const o of [f.at + 4 + side, f.at + 4 + 2 + side]) {
    if ((hasTag(b, o, 'Xing') || hasTag(b, o, 'Info')) && o + 12 <= b.length && (b[o + 7] & 1) !== 0) return be32(b, o + 8);
  }
  const vbri = f.at + 36;
  if (hasTag(b, vbri, 'VBRI') && vbri + 18 <= b.length) return be32(b, vbri + 14);
  return 0;
}

/** The first plausible frame in `b`: a valid header that a Xing tag, or a second valid header, backs up. */
function firstFrame(b: Uint8Array): Frame | null {
  for (let o = 0; o < Math.min(b.length, SCAN_BYTES + 4); o++) {
    const f = frameAt(b, o);
    if (!f) continue;
    if (declaredFrames(b, f) > 0) return f;
    const next = o + f.length;
    // A header with nothing after it to check (the buffer ends first) is taken on trust.
    const confirmed = next + 4 <= b.length ? frameAt(b, next) !== null : true;
    if (confirmed) return f;
  }
  return null;
}

/** Bytes taken by the ID3v2 tag at the start of `head` (header, body and footer), or 0 when there is none. */
export function id3v2Size(head: Uint8Array): number {
  if (head.length < 10 || !hasTag(head, 0, 'ID3') || head[3] < 2 || head[3] > 4) return 0;
  if (((head[6] | head[7] | head[8] | head[9]) & 0x80) !== 0) return 0; // sizes are 7 bits per byte
  const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  return 10 + size + (head[5] & 0x10 ? 10 : 0);
}

/**
 * Seconds (rounded) of the MP3 audio in `audio`, which must start at (or just before) the first frame: the bytes
 * after the ID3v2 tag. `audioBytes` is how much audio the file holds from there. 0 when it can't tell.
 */
export function mp3Duration(audio: Uint8Array, audioBytes: number): number {
  const f = firstFrame(audio);
  if (!f) return 0;
  const frames = declaredFrames(audio, f);
  const seconds = frames > 0 ? (frames * f.samplesPerFrame) / f.sampleRate : audioBytes > f.at ? ((audioBytes - f.at) * 8) / f.bitrate : 0;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
}

/** Reads bytes [start, end) of a file (clamped at its end). */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/**
 * Seconds (rounded) for an MP3 of `size` bytes, reading at most two slices of it: the head, then, behind a large
 * ID3v2 tag (cover art), the start of the audio. 0 when it can't tell, including when a read fails.
 */
export async function mp3DurationFrom(read: ReadRange, size: number): Promise<number> {
  try {
    if (size <= 0) return 0;
    const head = await read(0, MP3_HEAD_BYTES);
    const skip = id3v2Size(head);
    if (skip >= size) return 0;
    const inHead = head.length >= size || skip + SCAN_BYTES + 4 <= head.length;
    const audio = inHead ? head.subarray(Math.min(skip, head.length)) : await read(skip, skip + MP3_HEAD_BYTES);
    return mp3Duration(audio, size - skip);
  } catch {
    return 0;
  }
}
