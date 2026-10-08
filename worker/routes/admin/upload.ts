import { STATION_ID } from '../../../src/radio/schema.js';
import type { AppEnv } from '../../lib/env.js';
import { json, notConfigured } from '../../lib/http.js';
import { mediaBase, mediaUrl } from '../../lib/stations-store.js';
import { requireAdmin } from '../../lib/users.js';

const ALLOWED: Readonly<Record<'tracks' | 'covers', readonly string[]>> = {
  tracks: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg'],
  covers: ['image/jpeg', 'image/png', 'image/webp'],
};
const MAX_BYTES = 30 * 1024 * 1024;
const BAD_NAME = /[/\\\u0000-\u001f\u007f]/;

const badPath = (): Response =>
  json({ error: 'Uploads must go to tracks/<station>/<file> or covers/<station>/<file>' }, { status: 400 });

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PUT /api/admin/upload?folder=tracks|covers&station=<id>&name=<file>, body = the file.
 * Streamed straight to R2 (never buffered) under `<folder>/<station>/<8 hex>-<name>`; answers `{url, key, size}`.
 */
export async function PUT(req: Request, env: AppEnv): Promise<Response> {
  await requireAdmin(req, env);
  const base = mediaBase(env.MUSIC_BASE_URL);
  if (!base) return notConfigured();

  const params = new URL(req.url).searchParams;
  const folder = params.get('folder');
  const station = params.get('station') ?? '';
  const name = params.get('name') ?? '';
  if (folder !== 'tracks' && folder !== 'covers') return badPath();
  if (!STATION_ID.test(station)) return badPath();
  if (name.length < 1 || name.length > 200 || name === '.' || name === '..' || BAD_NAME.test(name)) return badPath();

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED[folder].includes(contentType)) return json({ error: 'That file type is not allowed here' }, { status: 415 });

  const declared = req.headers.get('content-length') ?? '';
  if (!/^\d{1,12}$/.test(declared)) return json({ error: 'Content-Length is required' }, { status: 411 });
  const length = Number(declared);
  if (length > MAX_BYTES) return json({ error: 'The file is too large (30 MB max)' }, { status: 413 });
  if (length === 0 || !req.body) return json({ error: 'The file is empty' }, { status: 400 });

  const key = `${folder}/${station}/${randomHex(4)}-${name}`;
  let size: number;
  try {
    // A week, not immutable: a removed file can stay cached at the edge that long (the admin says so when deleting).
    const obj = await env.MUSIC.put(key, req.body, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=604800' },
    });
    if (!obj) throw new Error('not written');
    size = obj.size;
  } catch {
    return json({ error: 'Upload failed. Try again.' }, { status: 503 });
  }
  // The runtime holds a request body to its Content-Length; this guards the cap if that ever changes.
  if (size !== length) {
    try {
      await env.MUSIC.delete(key);
    } catch {
      // an orphaned object is harmless: no station refers to it
    }
    return json({ error: 'The upload was incomplete. Try again.' }, { status: 400 });
  }
  return json({ url: mediaUrl(key, base), key, size });
}
