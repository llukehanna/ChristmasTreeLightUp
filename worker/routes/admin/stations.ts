import { del } from '@vercel/blob';
import { parseStationsFile, type StationsFile } from '../../src/radio/schema.js';
import { adminJson, readTextCapped, requireAdmin } from '../_lib/http.js';
import { MAX_VERSION, pruneOldVersions, readLatest, removedUrls, versionPath, writeCurrent, writeVersion, type VersionBlob } from '../_lib/stations-store.js';

// The Vercel request body limit is 4.5 MB, and a full list (20 stations x 500 tracks) fits well inside it.
const MAX_BODY = 4_400_000;

const conflict = (): Response =>
  adminJson({ error: 'Stations changed somewhere else. Reload to get the latest, then redo your change.' }, { status: 409 });

/** Both sides come from parseStationsFile, which builds objects in a fixed key order, so equal content stringifies identically. */
const sameFile = (a: StationsFile, b: StationsFile): boolean => JSON.stringify(a) === JSON.stringify(b);

export async function GET(req: Request): Promise<Response> {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    return adminJson((await readLatest()).file);
  } catch {
    return adminJson({ error: 'Could not read the stations' }, { status: 503 });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const denied = requireAdmin(req);
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
  let current: StationsFile;
  let versions: VersionBlob[];
  try {
    ({ file: current, versions } = await readLatest());
  } catch {
    return adminJson({ error: 'Could not read the stations' }, { status: 503 });
  }
  if (body.expectedVersion !== current.version) return conflict();
  if (current.version >= MAX_VERSION) return adminJson({ error: 'The station list has reached its version limit' }, { status: 503 });
  const next = parseStationsFile({ version: current.version + 1, stations: body.stations });
  if (!next) return adminJson({ error: 'Some station or track fields are invalid. Every track needs a title.' }, { status: 400 });

  try {
    await writeVersion(next);
  } catch {
    // Blob retries network errors, so a `put` can land while its response is lost and the retry then reports "already exists".
    // That is a success when the stored newest version is exactly what we tried to write.
    let latest: StationsFile;
    try {
      ({ file: latest, versions } = await readLatest());
    } catch {
      return adminJson({ error: 'Could not confirm whether the save went through. Reload to check.' }, { status: 503 });
    }
    // Nothing newer exists, so the write failed for some other reason: not a conflict.
    if (latest.version < next.version) return adminJson({ error: 'Could not save. Try again.' }, { status: 503 });
    if (!(latest.version === next.version && sameFile(latest, next))) return conflict();
  }

  let warning: string | undefined;
  try {
    await writeCurrent(next);
  } catch {
    warning = 'Saved, but the public list could not be refreshed yet. The next save will refresh it.';
  }
  // Cleanup is best-effort and independent: the save itself succeeded.
  try {
    const removed = removedUrls(current, next);
    if (removed.length) await del(removed);
  } catch {
    // leftover files are harmless
  }
  try {
    await pruneOldVersions([...versions, { pathname: versionPath(next.version), url: '' }]);
  } catch {
    // old versions are harmless
  }
  return adminJson({ version: next.version, ...(warning ? { warning } : {}) });
}
