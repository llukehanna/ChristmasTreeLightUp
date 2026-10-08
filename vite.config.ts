import { closeSync, createReadStream, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { ID3_HEAD_BYTES, ID3V1_BYTES, tagsFromFilename, trackTags, type Tags } from './src/radio/id3.ts';

const MUSIC_FOLDER = 'Music MP3s';
const AUDIO = /\.(mp3|m4a)$/i;

interface DevStationDef {
  id: string;
  name: string;
  /** Subfolders of the music dir (null = files at the top level). */
  folders: (string | null)[];
}
const DEV_STATIONS: DevStationDef[] = [
  // Top-level files join Classics.
  { id: 'christmas-classics', name: 'Christmas Classics', folders: ['Classics', null] },
  { id: 'christmas-jazz', name: 'Christmas Jazz', folders: ['Jazz'] },
];

function audioFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && AUDIO.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Tags by path, kept while the file's size and mtime are unchanged. */
const tagCache = new Map<string, { stamp: string; tags: Required<Tags> }>();

/** Title and artist from the file's ID3 tags (only the first 64 KB and the last 128 bytes are read), else its name. */
function fileTags(file: string, name: string): Required<Tags> {
  try {
    const st = statSync(file);
    const stamp = `${st.size}:${st.mtimeMs}`;
    const hit = tagCache.get(file);
    if (hit?.stamp === stamp) return hit.tags;
    const fd = openSync(file, 'r');
    try {
      const head = new Uint8Array(Math.min(st.size, ID3_HEAD_BYTES));
      readSync(fd, head, 0, head.length, 0);
      const tail = new Uint8Array(Math.min(st.size, ID3V1_BYTES));
      readSync(fd, tail, 0, tail.length, st.size - tail.length);
      const tags = trackTags(name, head, tail);
      tagCache.set(file, { stamp, tags });
      return tags;
    } finally {
      closeSync(fd);
    }
  } catch {
    return tagsFromFilename(name);
  }
}

function buildDevStations(musicDir: string) {
  const stations = DEV_STATIONS.map((def) => {
    const tracks = def.folders.flatMap((folder) => {
      const dir = folder ? resolve(musicDir, folder) : musicDir;
      return audioFiles(dir).map((f) => ({
        url: `/dev-music/${folder ? `${encodeURIComponent(folder)}/` : ''}${encodeURIComponent(f)}`,
        ...fileTags(resolve(dir, f), f),
      }));
    });
    return {
      id: def.id,
      name: def.name,
      description: 'Local test files',
      tracks: tracks.map((t, i) => ({
        id: `dev-${def.id}-${i}`,
        url: t.url,
        title: t.title.slice(0, 200),
        artist: t.artist.slice(0, 200),
        credit: 'Local test file (never deployed)',
        duration: 0,
      })),
    };
  }).filter((s) => s.tracks.length > 0);
  return { version: 0, stations };
}

/**
 * Maps the request path after `/dev-music/` to a file inside musicDir, or null.
 * Allows `<file>` or `<Folder>/<file>` only; rejects traversal, absolute paths and encoded separators.
 */
function resolveMusicFile(musicDir: string, rest: string): string | null {
  const segments = rest.split('/');
  if (segments.length < 1 || segments.length > 2) return null;
  const decoded: string[] = [];
  for (const raw of segments) {
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (s === '' || s === '.' || s === '..' || /[/\\\u0000]/.test(s)) return null;
    decoded.push(s);
  }
  const file = resolve(musicDir, ...decoded);
  const rel = relative(musicDir, file);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  if (!AUDIO.test(file) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/**
 * Dev-only: serves Luke's local test tracks (git-ignored "Music MP3s/Classics" and "/Jazz") as stations.
 * `apply: 'serve'` guarantees none of this exists in production builds.
 */
function devMusic(): Plugin {
  return {
    name: 'aglow-dev-music',
    apply: 'serve',
    configureServer(server) {
      const musicDir = resolve(server.config.root, MUSIC_FOLDER);
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/dev-stations.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(buildDevStations(musicDir)));
          return;
        }
        if (url.startsWith('/dev-music/')) {
          const file = resolveMusicFile(musicDir, url.slice('/dev-music/'.length));
          if (!file) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const size = statSync(file).size;
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Type', file.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg');
          let start = 0;
          let end = size - 1;
          let partial = false;
          const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
          if (m && (m[1] !== '' || m[2] !== '') && size > 0) {
            if (m[1] === '') {
              // Suffix range: the last N bytes.
              const n = Number(m[2]);
              if (n > 0) {
                start = Math.max(0, size - n);
                partial = true;
              }
            } else {
              const s = Number(m[1]);
              const e = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
              if (s >= size) {
                res.statusCode = 416;
                res.setHeader('Content-Range', `bytes */${size}`);
                res.end();
                return;
              }
              // end < start is malformed: ignore the header and serve the whole file.
              if (e >= s) {
                start = s;
                end = e;
                partial = true;
              }
            }
          }
          if (partial) {
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', String(end - start + 1));
          } else {
            res.setHeader('Content-Length', String(size));
          }
          if (size === 0) {
            res.end();
            return;
          }
          const stream = createReadStream(file, { start, end });
          // pipeline destroys the file stream when the client aborts (e.g. seeking) and on read errors.
          pipeline(stream, res, () => {});
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devMusic()],
  build: {
    target: 'es2022',
    // Two pages: the game, and the radio admin (served at /admin). The game's chunks never include admin code.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  // 30 s: the suite runs in parallel (CPU-heavy replays, a real local D1 per file), and `npm run deploy` gates on it.
  test: { include: ['tests/unit/**/*.test.ts', 'tests/worker/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 30_000 },
});
