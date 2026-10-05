/**
 * Dev-only track tags for the local test music (used by the dev-music plugin in vite.config.ts; never bundled).
 * A tiny reader for the two text frames we need: ID3v2.2–2.4 title/artist, then ID3v1, then the file name.
 * Pure functions over bytes, so it is unit-tested without the file system.
 */

export interface Tags {
  title?: string;
  artist?: string;
}

/** How much of each file the plugin reads for ID3v2 (tags with big cover art before the text frames fall back). */
export const ID3_HEAD_BYTES = 64 * 1024;
export const ID3V1_BYTES = 128;

const syncsafe = (b: Uint8Array, o: number): number => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be24 = (b: Uint8Array, o: number): number => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];

/** Undo ID3 unsynchronisation: every 0xFF 0x00 pair becomes 0xFF. */
function unsync(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

const latin1 = (b: Uint8Array): string => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
};

/** Splits on the encoding's terminator (one 0 byte, or a 0x0000 pair on an even offset for UTF-16). */
function splitTerminated(b: Uint8Array, wide: boolean): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let start = 0;
  const step = wide ? 2 : 1;
  for (let i = 0; i + step - 1 < b.length; i += step) {
    if (b[i] === 0 && (!wide || b[i + 1] === 0)) {
      parts.push(b.subarray(start, i));
      start = i + step;
    }
  }
  parts.push(b.subarray(start, b.length - ((b.length - start) % step)));
  return parts;
}

function decodeUtf16(b: Uint8Array, defaultLE: boolean): string {
  let le = defaultLE;
  let body = b;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    le = true;
    body = b.subarray(2);
  } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    le = false;
    body = b.subarray(2);
  }
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body);
}

/** A text frame's value: encoding byte, then one or more strings (v2.4 separates several values with terminators). */
export function decodeText(frame: Uint8Array): string {
  if (frame.length === 0) return '';
  const enc = frame[0];
  const body = frame.subarray(1);
  const wide = enc === 1 || enc === 2;
  const values = splitTerminated(body, wide).map((part) => {
    if (enc === 1) return decodeUtf16(part, true);
    if (enc === 2) return decodeUtf16(part, false);
    if (enc === 3) return new TextDecoder('utf-8').decode(part);
    return latin1(part);
  });
  return values
    .map((v) => v.replace(/\u0000/g, '').trim())
    .filter((v) => v !== '')
    .join(', ');
}

/** Title (TIT2/TT2) and artist (TPE1/TP1) from an ID3v2 tag at the start of `head`. Truncated tags yield what was read. */
export function readId3v2(head: Uint8Array): Tags {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {}; // "ID3"
  const major = head[3];
  if (major < 2 || major > 4) return {};
  const flags = head[5];
  const size = syncsafe(head, 6);
  let tag = head.subarray(10, Math.min(head.length, 10 + size));
  // v2.2/v2.3 unsynchronise the whole tag; v2.4 marks it per frame.
  if (flags & 0x80 && major < 4) tag = unsync(tag);
  let p = 0;
  if (flags & 0x40 && major >= 3) {
    // Extended header: v2.3 gives its size excluding the 4 size bytes, v2.4 including them (syncsafe).
    p = major === 3 ? 4 + be32(tag, 0) : syncsafe(tag, 0);
  }
  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  const want: Record<string, keyof Tags> = major === 2 ? { TT2: 'title', TP1: 'artist' } : { TIT2: 'title', TPE1: 'artist' };
  const out: Tags = {};
  while (p + headLen <= tag.length) {
    if (tag[p] === 0) break; // padding
    const id = latin1(tag.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = major === 2 ? be24(tag, p + 3) : major === 4 ? syncsafe(tag, p + 4) : be32(tag, p + 4);
    const fflags = major === 2 ? 0 : tag[p + 9];
    const start = p + headLen;
    if (len <= 0 || start + len > tag.length) break;
    const key = want[id];
    // Compressed (0x08 in v2.4, 0x80 in v2.3) and encrypted frames are skipped: dev tags never use them.
    const packed = major === 4 ? fflags & 0x0c : major === 3 ? fflags & 0xc0 : 0;
    if (key && !packed && out[key] === undefined) {
      let data = tag.subarray(start, start + len);
      if (major === 4 && fflags & 0x01) data = data.subarray(4); // data length indicator
      if (major === 4 && fflags & 0x02) data = unsync(data);
      const text = decodeText(data);
      if (text) out[key] = text;
    }
    if (out.title !== undefined && out.artist !== undefined) break;
    p = start + len;
  }
  return out;
}

/** Title and artist from a 128-byte ID3v1 tag (the last bytes of the file). */
export function readId3v1(tail: Uint8Array): Tags {
  if (tail.length < 128) return {};
  const t = tail.subarray(tail.length - 128);
  if (t[0] !== 0x54 || t[1] !== 0x41 || t[2] !== 0x47) return {}; // "TAG"
  const field = (o: number) => latin1(t.subarray(o, o + 30)).replace(/\u0000.*$/s, '').trim();
  const out: Tags = {};
  const title = field(3);
  const artist = field(33);
  if (title) out.title = title;
  if (artist) out.artist = artist;
  return out;
}

/** Suffixes that are a version note, not an artist ("Blue Christmas - Remastered 1999"). */
const VERSION_NOTE = /\b(version|remaster(ed)?|remix|mix|edit|mono|stereo|single|live|demo|take)\b/i;

/** "Sleigh Ride - Roddy Doyle Trio.mp3" → title "Sleigh Ride", artist "Roddy Doyle Trio". */
export function tagsFromFilename(file: string): Required<Tags> {
  const base = file.replace(/\.[a-z0-9]{2,4}$/i, '').trim();
  const cut = base.lastIndexOf(' - ');
  if (cut > 0) {
    const title = base.slice(0, cut).trim();
    const artist = base.slice(cut + 3).trim();
    if (title && artist && !VERSION_NOTE.test(artist)) return { title, artist };
  }
  return { title: base, artist: '' };
}

/** Best title and artist: ID3v2, then ID3v1, then the file name, field by field. */
export function trackTags(file: string, head: Uint8Array, tail: Uint8Array): Required<Tags> {
  const v2 = readId3v2(head);
  const v1 = readId3v1(tail);
  const name = tagsFromFilename(file);
  return {
    title: v2.title ?? v1.title ?? name.title,
    artist: v2.artist ?? v1.artist ?? name.artist,
  };
}
