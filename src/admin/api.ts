import type { AccountStats, ImportRequest, ImportResponse } from '../api/types.js';
import type { Station, StationsFile } from '../radio/schema.js';
import { localDay } from '../store/stats.js';
import { safeUploadName } from './names.js';

/** An admin API failure: the Worker's `{error}` text and the HTTP status (0 when the server could not be reached). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

/** The Worker's `{error, message}` (or an older route's `{error: text}`) as one line. */
const errorText = (data: unknown, status: number): string => {
  const o = typeof data === 'object' && data !== null ? (data as { error?: unknown; message?: unknown }) : {};
  if (typeof o.message === 'string' && o.message) return o.message;
  return typeof o.error === 'string' && o.error ? o.error : `Request failed (${status})`;
};

async function call<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, UNREACHABLE);
  }
  const data: unknown = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, errorText(data, r.status));
  return data as T;
}

export type Folder = 'tracks' | 'covers';

/** "Sign in with Google": Google (fake sign-in locally), then back to /admin. */
export const SIGN_IN_HREF = `/api/auth/google?return=${encodeURIComponent('/admin')}`;

/** The Worker's admin API (worker/routes/admin/*). Every failure is an ApiError. */
export const api = {
  /** 200 for the admin; otherwise an ApiError with status 401 (signed out) or 403 (another Google account). */
  session: () => call<{ admin: true; name: string | null }>('GET', '/api/admin/session'),
  signOut: () => call<Record<string, never>>('POST', '/api/auth/signout', {}),
  load: () => call<StationsFile>('GET', '/api/admin/stations'),
  save: (expectedVersion: number, stations: Station[]) => call<{ version: number }>('PUT', '/api/admin/stations', { expectedVersion, stations }),
  /** The signed-in account's stats (GET /api/me/stats): the history card's played and imported counts. */
  stats: (now: Date) => call<AccountStats>('GET', `/api/me/stats?today=${localDay(now)}&tz=${now.getTimezoneOffset()}`),
  /** POST /api/admin/import: this device's history becomes runs on the admin's own account. */
  importHistory: (body: ImportRequest) => call<ImportResponse>('POST', '/api/admin/import', body),
  /**
   * Streams one file to R2 through the Worker (`PUT /api/admin/upload`), reporting progress 0–100.
   * XMLHttpRequest rather than fetch, because only it reports upload progress.
   */
  uploadFile: (folder: Folder, stationId: string, file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<{ url: string }> =>
    new Promise((resolve, reject) => {
      // Aborting through `signal` rejects with its reason when that is an Error (e.g. the stall watchdog's).
      const cancelled = (): Error => (signal?.reason instanceof Error ? signal.reason : new ApiError(0, 'Upload cancelled'));
      if (signal?.aborted) {
        reject(cancelled());
        return;
      }
      const query = new URLSearchParams({ folder, station: stationId, name: safeUploadName(file.name) });
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/admin/upload?${query.toString()}`);
      // Tracks with no type from the OS are MP3s (the picker only offers audio); a cover must carry its own type.
      xhr.setRequestHeader('Content-Type', folder === 'tracks' ? file.type || 'audio/mpeg' : file.type);
      xhr.responseType = 'text';
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        let data: unknown = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          // not JSON: reported by status below
        }
        const url = typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined;
        if (xhr.status >= 200 && xhr.status < 300 && typeof url === 'string') resolve({ url });
        else reject(new ApiError(xhr.status, errorText(data, xhr.status)));
      };
      xhr.onerror = () => reject(new ApiError(0, UNREACHABLE));
      xhr.onabort = () => reject(cancelled());
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(file);
    }),
};

/** Seconds, rounded, from the browser's own decoder; 0 when it can't tell (or takes longer than `timeoutMs`). */
export function audioDuration(file: File, timeoutMs = 20_000): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (d: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done(0), timeoutMs);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? Math.round(a.duration) : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}
