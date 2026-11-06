import type { LogEntry } from '../core/log';
import { localDay } from '../store/stats';
import { BOARD_WINDOWS, type AccountStats, type BoardResponse, type BoardWindow, type ClaimResponse, type DailyRequest, type FinishResult, type HomeAloneResponse, type MeResponse, type MyGamesResponse, type NameCheck, type StarHeadResponse, type StartResponse, type User } from './types';

/** An API failure: the HTTP status (0 when the server couldn't be reached), the Worker's error code and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A new tree never waits longer than this for the server's seed; past it, it starts offline (spec §5.1). */
export const START_TIMEOUT_MS = 1500;
/** A failed finish is sent again once, this much later (spec §5.3). */
export const FINISH_RETRY_MS = 800;
const TIMEOUT_MS = 10_000;

let onUnauthorized: (() => void) | null = null;
/** A 401 on any call means the session is gone: the app signs out locally (spec §5.4). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs = TIMEOUT_MS, cache: RequestCache = 'no-store'): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      method,
      signal: abort.signal,
      credentials: 'same-origin',
      cache,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const { error, message } = (typeof data === 'object' && data !== null ? data : {}) as { error?: unknown; message?: unknown };
      if (res.status === 401) onUnauthorized?.();
      throw new ApiError(res.status, typeof error === 'string' ? error : 'server', typeof message === 'string' ? message : 'Something went wrong.');
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'offline', "Couldn't reach Aglow.");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The board is the one response the browser may keep (`private, max-age=15`, `Vary: Cookie`): opening it again soon
 * costs no request. After this page changes it (a finish, a claim, a name, signing out or deleting the account), the
 * next board of each window is revalidated (the browser may hold a copy of each), so your new run is never hidden by
 * the browser's copy.
 */
const staleWindows = new Set<BoardWindow>();
async function changesBoard<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  for (const w of BOARD_WINDOWS) staleWindows.add(w);
  return r;
}
/** One window of the board (spec 2026-10-14): today and this week are this browser's day and zone, as myStats sends them. */
async function board(win: BoardWindow = 'all', now: Date = new Date()): Promise<BoardResponse> {
  const path = win === 'all' ? '/api/board?window=all' : `/api/board?window=${win}&today=${localDay(now)}&tz=${now.getTimezoneOffset()}`;
  // Cleared before asking, so a write landing while this is in flight marks the window again; put back if this fails.
  const revalidate = staleWindows.delete(win);
  try {
    return await request<BoardResponse>('GET', path, undefined, TIMEOUT_MS, revalidate ? 'no-cache' : 'default');
  } catch (e) {
    if (revalidate) staleWindows.add(win);
    throw e;
  }
}

/** Everything but the board is never cached: writes, and reads that are yours alone. */
export const api = {
  me: () => request<MeResponse>('GET', '/api/me'),
  checkName: (n: string) => request<NameCheck>('GET', `/api/auth/name?n=${encodeURIComponent(n)}`),
  setName: (name: string) => changesBoard(request<{ user: User }>('POST', '/api/auth/name', { name })),
  signOut: () => changesBoard(request<Record<string, never>>('POST', '/api/auth/signout', {})),
  deleteAccount: (confirm: string) => changesBoard(request<Record<string, never>>('DELETE', '/api/me', { confirm })),
  /** A random tree, or with `daily` the Daily Tree (or a past day's). */
  start: (daily?: DailyRequest) => request<StartResponse>('POST', '/api/games', daily ? { daily } : {}, START_TIMEOUT_MS),
  finish: (id: string, log: readonly LogEntry[]) => changesBoard(request<FinishResult>('POST', `/api/games/${encodeURIComponent(id)}/finish`, { log })),
  claim: (claims: readonly { id: string; claim: string }[]) => changesBoard(request<ClaimResponse>('POST', '/api/games/claim', { claims })),
  board,
  myGames: () => request<MyGamesResponse>('GET', '/api/me/games'),
  /** The account's copy of the tree's topper preference (the star-head egg). */
  setStarHead: (on: boolean) => request<StarHeadResponse>('PUT', '/api/me/star-head', { on }),
  /** The account's copy of Home Alone mode. */
  setHomeAlone: (on: boolean) => request<HomeAloneResponse>('PUT', '/api/me/home-alone', { on }),
  /** The account's stats in this browser's day and zone (spec 2026-10-08 §3.2). */
  myStats: (now: Date = new Date()) => request<AccountStats>('GET', `/api/me/stats?today=${localDay(now)}&tz=${now.getTimezoneOffset()}`),
};

/** Where the browser goes to sign in; the Worker sends it on to Google and back to `returnPath`. */
export const signInHref = (returnPath: string): string => `/api/auth/google?return=${encodeURIComponent(returnPath)}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends a finish, and once more after FINISH_RETRY_MS on a network error or a 5xx. An answer (4xx) is final.
 * `beforeSend` runs just ahead of each attempt (the retry too), so the caller can note how late that attempt is.
 */
export async function finishWithRetry(
  id: string,
  log: readonly LogEntry[],
  wait: (ms: number) => Promise<void> = sleep,
  beforeSend: () => void = () => undefined,
): Promise<FinishResult> {
  try {
    beforeSend();
    return await api.finish(id, log);
  } catch (e) {
    if (e instanceof ApiError && e.status > 0 && e.status < 500) throw e;
    await wait(FINISH_RETRY_MS);
    beforeSend();
    return api.finish(id, log);
  }
}
