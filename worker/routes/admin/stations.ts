import { parseStationsFile, type StationsFile } from '../../../src/radio/schema.js';
import type { AppEnv, Ctx } from '../../lib/env.js';
import { adminJson, readTextCapped, requireAdmin } from '../../lib/http.js';
import { resetPublicCache } from '../../lib/public-stations.js';
import { deleteKeys, mediaBase, readStations, removedMediaKeys, writeStations } from '../../lib/stations-store.js';

// A full list (20 stations x 500 tracks) fits well inside this.
const MAX_BODY = 4 * 1024 * 1024;

const conflict = (): Response =>
  adminJson({ error: 'Stations changed somewhere else. Reload to get the latest, then redo your change.' }, { status: 409 });
const unreadable = (): Response => adminJson({ error: 'Could not read the stations' }, { status: 503 });

/** Both sides come from parseStationsFile, which builds objects in a fixed key order, so equal content stringifies identically. */
const sameFile = (a: StationsFile, b: StationsFile): boolean => JSON.stringify(a) === JSON.stringify(b);

export async function GET(req: Request, env: AppEnv): Promise<Response> {
  const denied = await requireAdmin(req, env);
  if (denied) return denied;
  try {
    return adminJson((await readStations(env.MUSIC)).file);
  } catch {
    return unreadable();
  }
}

export async function PUT(req: Request, env: AppEnv, ctx: Ctx): Promise<Response> {
  const denied = await requireAdmin(req, env);
  if (denied) return denied;
  const text = await readTextCapped(req, MAX_BODY);
  if (text === null) return adminJson({ error: 'Request too large' }, { status: 413 });
  let body: { expectedVersion?: unknown; stations?: unknown };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad body');
    body = parsed as typeof body;
  } catch {
    return adminJson({ error: 'Invalid JSON' }, { status: 400 });
  }
  const bucket = env.MUSIC;
  let current: StationsFile;
  let etag: string | null;
  try {
    ({ file: current, etag } = await readStations(bucket));
  } catch {
    return unreadable();
  }
  if (body.expectedVersion !== current.version) return conflict();
  const next = parseStationsFile({ version: current.version + 1, stations: body.stations });
  if (!next) return adminJson({ error: 'Some station or track fields are invalid. Every track needs a title.' }, { status: 400 });

  try {
    // Conditional on the etag just read (or on nothing existing yet): a save that landed in between makes this a no-op.
    if (!(await writeStations(bucket, next, etag))) return conflict();
  } catch {
    // The write may have landed even though its response was lost. It is a success if the stored file is exactly ours.
    let stored: StationsFile;
    try {
      ({ file: stored } = await readStations(bucket));
    } catch {
      return adminJson({ error: 'Could not confirm whether the save went through. Reload to check.' }, { status: 503 });
    }
    if (!sameFile(stored, next)) return adminJson({ error: 'Could not save. Try again.' }, { status: 503 });
  }
  resetPublicCache();

  // Best-effort cleanup after the response: leftover files are harmless.
  const removed = removedMediaKeys(current, next, mediaBase(env.MUSIC_BASE_URL));
  if (removed.length) ctx.waitUntil(deleteKeys(bucket, removed).catch(() => undefined));
  return adminJson({ version: next.version });
}
