import type { UnrankedReason } from '../core/judge';

/** JSON shapes shared by the Worker and the browser (specs 2026-10-07 §3, 2026-10-08 §3), plus a few shared constants. */
export type { UnrankedReason };

/** Most claims one POST /api/games/claim handles; the browser sends them in batches of this many. */
export const MAX_CLAIMS_PER_REQUEST = 8;

export interface User {
  /** null until the player picks one. */
  name: string | null;
  isAdmin: boolean;
}

export interface MeResponse {
  user: User | null;
}

export interface NameCheck {
  available: boolean;
  reason?: 'invalid' | 'reserved' | 'taken';
}

export interface StartResponse {
  id: string;
  seed: number;
  genVersion: number;
  /** Proves ownership of a game played signed out (only its HMAC is stored); null when signed in. */
  claim: string | null;
}

export interface FinishResult {
  id: string;
  ranked: boolean;
  reason: UnrankedReason | null;
  /** Ranked time (active ms), computed by the server. */
  ms: number;
  /** This run's place on the board, or for an 'anonymous' run the place it would take once claimed. Null otherwise. */
  rank: number | null;
  /** Ranked runs on the board (named players only). */
  total: number;
  /** The owner's best ranked time after this run; null when signed out or with no ranked run yet. */
  best: number | null;
  /** This run is now the owner's best ranked run. */
  newBest: boolean;
}

export interface ClaimResponse {
  results: FinishResult[];
}

export interface BoardRow {
  rank: number;
  name: string;
  ms: number;
  finishedAt: number;
  /** One of the signed-in player's runs. */
  mine: boolean;
}

export interface BoardResponse {
  /** The top 50 runs. */
  rows: BoardRow[];
  /** Ranked runs on the board. */
  total: number;
  /** Your best run's row when it is outside the top 50. */
  you: BoardRow | null;
}

export interface RecentGame {
  id: string;
  ms: number;
  finishedAt: number;
  ranked: boolean;
  reason: UnrankedReason | null;
  /** This run is the player's best ranked run. */
  isBest: boolean;
}

export interface MyGamesResponse {
  best: { ms: number; rank: number | null; finishedAt: number } | null;
  /** How many of the top 50 runs are yours. */
  inTop: number;
  total: number;
  /** The last 30 finished games, newest first. */
  games: RecentGame[];
}

/** History import (spec 2026-10-08): the game's first day. No imported run is dated before it. */
export const HISTORY_FIRST_DAY = '2026-09-29';
/** Most runs one import may add. */
export const MAX_IMPORT_RUNS = 2000;
/** An imported best is whole seconds and at least this (the judge's ranked floor is 5 s). */
export const MIN_IMPORT_BEST_SECONDS = 5;
/** An imported best or average is at most an hour. */
export const MAX_IMPORT_MS = 3_600_000;
/** An imported streak is at most ten years of days. */
export const MAX_STREAK_DAYS = 3650;

/** POST /api/admin/import: this device's stats, as the admin confirmed or edited them. */
export interface ImportRequest {
  /** Made by the browser before the first send and reused on every resend (16–32 of A–Z a–z 0–9 _ -). */
  importId: string;
  solved: number;
  /** Whole seconds, as the device keeps its best. */
  bestSeconds: number;
  /** Exact ms: the total is solved × averageMs. */
  averageMs: number;
  streak: number;
  longestStreak: number;
  /** The device's local YYYY-MM-DD. */
  lastSolvedDay: string;
  /** Date#getTimezoneOffset() at import time: UTC minus local, in minutes (420 in PDT). */
  tz: number;
}

/** POST /api/admin/import's answer. */
export interface ImportResponse {
  /** Runs inserted (0 when this importId was imported before). */
  added: number;
  already: boolean;
  /** What the dates show: the request's streaks, or less when they didn't fit between 2026-09-29 and the last day. */
  streak: number;
  longestStreak: number;
  clamped: boolean;
}
