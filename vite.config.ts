import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

function buildDevStations(musicDir: string) {
  const stations = DEV_STATIONS.map((def) => {
    const tracks = def.folders.flatMap((folder) =>
      audioFiles(folder ? resolve(musicDir, folder) : musicDir).map((f) => ({
        url: `/dev-music/${folder ? `${encodeURIComponent(folder)}/` : ''}${encodeURIComponent(f)}`,
        title: f.replace(AUDIO, ''),
      })),
    );
    return {
      id: def.id,
      name: def.name,
      description: 'Local test files',
      tracks: tracks.map((t, i) => ({
        id: `dev-${def.id}-${i}`,
        url: t.url,
        title: t.title,
        artist: 'Local test file',
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
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
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
          stream.on('error', () => res.destroy());
          stream.pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [devMusic()],
  build: { target: 'es2022' },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
