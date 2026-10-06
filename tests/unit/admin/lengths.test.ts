import { describe, expect, it } from 'vitest';
import { fillMissingLengths, isMp3, mp3DurationOfBlob, mp3DurationOfUrl, runPool, totalFromContentRange } from '../../../src/admin/lengths';

// Synthesized bytes only: an MPEG-1 Layer III 128 kbit/s frame header (16 000 audio bytes per second) over zeros.
const HEADER = [0xff, 0xfb, 0x90, 0x00];
function mp3(seconds: number, id3Body = 0): Uint8Array<ArrayBuffer> {
  const tag = id3Body ? 10 + id3Body : 0;
  const out = new Uint8Array(tag + seconds * 16_000);
  if (id3Body) out.set([0x49, 0x44, 0x33, 3, 0, 0, (id3Body >> 21) & 0x7f, (id3Body >> 14) & 0x7f, (id3Body >> 7) & 0x7f, id3Body & 0x7f]);
  out.set(HEADER, tag);
  out.set(HEADER, tag + 417);
  return out;
}

interface Host {
  fetchFn: typeof fetch;
  requests: { url: string; range: string | null }[];
}
/** A media host that serves ranges (CORS aside), or answers 200 to everything when `ranges` is false. */
function host(files: Record<string, Uint8Array<ArrayBuffer>>, opts: { ranges?: boolean; exposeRange?: boolean } = {}): Host {
  const requests: Host['requests'] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const range = new Headers(init?.headers).get('Range');
    requests.push({ url, range });
    const file = files[url];
    if (!file) return new Response('missing', { status: 404 });
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(file.length) } });
    const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (opts.ranges === false || !m) return new Response(file);
    const start = Number(m[1]);
    const end = Math.min(Number(m[2]), file.length - 1);
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: opts.exposeRange === false ? {} : { 'Content-Range': `bytes ${start}-${end}/${file.length}` },
    });
  };
  return { fetchFn, requests };
}

describe('isMp3', () => {
  it('goes by the type, or by the extension when the OS gave none', () => {
    expect(isMp3({ type: 'audio/mpeg', name: 'x' })).toBe(true);
    expect(isMp3({ type: '', name: 'Sleigh Ride.MP3' })).toBe(true);
    expect(isMp3({ type: 'audio/mp4', name: 'x.m4a' })).toBe(false);
  });
});

describe('mp3DurationOfBlob', () => {
  it('reads a Blob by slices', async () => {
    expect(await mp3DurationOfBlob(new Blob([mp3(90)]))).toBe(90);
    expect(await mp3DurationOfBlob(new Blob([mp3(75, 200_000)]))).toBe(75); // behind a 200 KB tag
    expect(await mp3DurationOfBlob(new Blob([new Uint8Array(500)]))).toBe(0);
  });
});

describe('totalFromContentRange', () => {
  it('takes the total after the slash', () => {
    expect(totalFromContentRange('bytes 0-65535/1234567')).toBe(1234567);
    expect(totalFromContentRange('bytes 0-99/100')).toBe(100);
  });
  it('is 0 when missing, unknown (*) or malformed', () => {
    expect(totalFromContentRange(null)).toBe(0);
    expect(totalFromContentRange('bytes 0-99/*')).toBe(0);
    expect(totalFromContentRange('bytes */100')).toBe(0);
    expect(totalFromContentRange('nonsense')).toBe(0);
  });
});

describe('mp3DurationOfUrl', () => {
  it('asks for the first 64 KB only, and computes the length from Content-Range', async () => {
    const h = host({ 'https://m.example/a.mp3': mp3(180) });
    expect(await mp3DurationOfUrl('https://m.example/a.mp3', h.fetchFn)).toBe(180);
    expect(h.requests).toEqual([{ url: 'https://m.example/a.mp3', range: 'bytes=0-65535' }]);
  });
  it('makes a second range request for the audio behind a big ID3v2 tag', async () => {
    const h = host({ 'https://m.example/art.mp3': mp3(120, 250_000) });
    expect(await mp3DurationOfUrl('https://m.example/art.mp3', h.fetchFn)).toBe(120);
    expect(h.requests.map((r) => r.range)).toEqual(['bytes=0-65535', 'bytes=250010-315545']);
  });
  it('is 0 for a missing file, a host that ignores Range (a 200 is the whole file), and a network error', async () => {
    expect(await mp3DurationOfUrl('https://m.example/none.mp3', host({}).fetchFn)).toBe(0);
    expect(await mp3DurationOfUrl('https://m.example/a.mp3', host({ 'https://m.example/a.mp3': mp3(10) }, { ranges: false }).fetchFn)).toBe(0);
    expect(await mp3DurationOfUrl('https://m.example/a.mp3', () => Promise.reject(new TypeError('Failed to fetch')))).toBe(0);
  });
  it('takes the size from a HEAD request when the host does not expose Content-Range to scripts', async () => {
    const h = host({ 'https://m.example/a.mp3': mp3(150) }, { exposeRange: false });
    expect(await mp3DurationOfUrl('https://m.example/a.mp3', h.fetchFn)).toBe(150);
    expect(h.requests.map((r) => r.range)).toEqual(['bytes=0-65535', null]);
  });
  it('is 0 when the size can be found neither way', async () => {
    const f: typeof fetch = async (_url, init) =>
      init?.method === 'HEAD' ? new Response(null, { status: 403 }) : new Response(mp3(10).slice(0, 5000), { status: 206 });
    expect(await mp3DurationOfUrl('https://m.example/a.mp3', f)).toBe(0);
  });
});

describe('runPool', () => {
  it('never runs more than the limit at once, and finishes everything', async () => {
    let live = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      done.push(n);
    });
    expect(peak).toBe(4);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it('handles an empty list', async () => {
    await runPool([], 4, () => Promise.reject(new Error('never')));
  });
});

describe('fillMissingLengths', () => {
  const track = (name: string, duration: number) => ({ url: `https://m.example/${name}.mp3`, duration });
  it('looks up only the tracks at 0, reports each found length, and leaves failures alone', async () => {
    const h = host({
      'https://m.example/a.mp3': mp3(100),
      'https://m.example/c.mp3': mp3(200),
      // b is not on the host; d already has a length; e is not an MP3 at all
      'https://m.example/e.mp3': new Uint8Array(70_000),
    });
    const tracks = [track('a', 0), track('b', 0), track('c', 0), track('d', 61), track('e', 0)];
    const found: [string, number][] = [];
    const r = await fillMissingLengths(tracks, (t, s) => found.push([t.url, s]), h.fetchFn);
    expect(r).toEqual({ found: 2, failed: 2 });
    expect(found.sort()).toEqual([
      ['https://m.example/a.mp3', 100],
      ['https://m.example/c.mp3', 200],
    ]);
    expect(h.requests.some((q) => q.url.endsWith('/d.mp3'))).toBe(false);
  });
  it('runs at most 4 lookups at once', async () => {
    let live = 0;
    let peak = 0;
    const f: typeof fetch = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return new Response('x', { status: 500 });
    };
    const tracks = Array.from({ length: 12 }, (_, i) => track(`t${i}`, 0));
    expect(await fillMissingLengths(tracks, () => undefined, f)).toEqual({ found: 0, failed: 12 });
    expect(peak).toBe(4);
  });
});
