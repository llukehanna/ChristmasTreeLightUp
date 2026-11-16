import type { ItemId } from '../core/catalogue';
import type { GoalId, GoalState } from '../core/goals';
import type { UnrankedReason } from '../core/judge';
import type { LogEntry } from '../core/log';

/** JSON shapes shared by the Worker and the browser (specs 2026-10-07 §3, 2026-10-08 §3), plus a few shared constants. */
export type { UnrankedReason };

/** Most claims one POST /api/games/claim handles; the browser sends them in batches of this many. */
export const MAX_CLAIMS_PER_REQUEST = 8;
/** How many runs the leaderboard shows (and Your games counts "in the top"). */
export const BOARD_TOP = 50;
/**
 * The leaderboard's windows (spec 2026-10-14): the viewer's day's Daily Tree (its first attempts only), since the
 * viewer's midnight, since their Monday's, or every run.
 */
export const BOARD_WINDOWS = ['daily', 'today', 'week', 'all'] as const;
export type BoardWindow = (typeof BOARD_WINDOWS)[number];

export interface User {
  /**
   * The account's id: whose unlocks this device keeps (src/store/unlocks.ts). The Worker always sends it; a user without
   * one (hand-made in tests) has no key, and sees this device's unlocks alone.
   */
  id?: number;
  /** null until the player picks one. */
  name: string | null;
  isAdmin: boolean;
  /** The tree's topper preference: on load and sign-in the account's value wins over this browser's. */
  starHead: boolean;
  /**
   * Home Alone mode (spec 2026-10-14): on load and sign-in the account's value wins. The Worker always sends it; read
   * as off when absent, so hand-made users (tests, a Worker from before migration 0004) need not carry it.
   */
  homeAlone?: boolean;
}

/** PUT /api/me/home-alone { on }'s answer. */
export interface HomeAloneResponse {
  homeAlone: boolean;
}

export interface MeResponse {
  user: User | null;
}

/** PUT /api/me/star-head { on }'s answer. */
export interface StarHeadResponse {
  starHead: boolean;
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
  /** Set when this is a Daily Tree start; null for a random game. */
  daily: DailyInfo | null;
}

/** POST /api/games { daily }: the player's local date, and for a past day's tree (Advent catch-up) that day. */
export interface DailyRequest {
  today: string;
  day?: string;
}
export interface DailyInfo {
  /** YYYY-MM-DD */
  day: string;
  /** A day already over for the player: unranked, never on a Daily board, never a streak day. */
  past: boolean;
  /** The signed-in player has started this day's tree before: not their first attempt. */
  repeat: boolean;
}

/**
 * POST /api/games/:id/finish { log, ctx? }: what the browser reports at the win (season two C2+C3), for the calendar
 * and secret goals only. Self-reported; one that fails the Worker's checks is dropped and the run still finishes.
 */
export interface RunContext {
  /** Date#getTimezoneOffset() at the win: UTC minus local, in minutes. */
  tz: number;
  /** The radio station playing (a station id, /^[a-z0-9-]{1,64}$/), or null. */
  station: string | null;
  /** An egg world the tree was lit in, or null. */
  world: 'secret' | 'home-alone' | null;
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
  /** Set for a Daily Tree run (every field above stays the main board's); null for a random game. */
  daily: DailyResult | null;
  /** Taps this run made, from the server's replay of the log; null for a run too long to count. */
  turns: number | null;
  /** The tree's fewest turns from the start (see minTurnsOf); null when `turns` is. */
  minTurns: number | null;
}

/** A finished Daily Tree run on its day's own board. */
export interface DailyResult {
  /** YYYY-MM-DD */
  day: string;
  past: boolean;
  /** This game is the owner's earliest-started live game for the day (always true for a guest's live game). */
  first: boolean;
  /** Place on the day's board, or the place it would take once claimed or named; null unless first and reason 'daily'. */
  rank: number | null;
  /** Runs on the day's board (+1 when this run would join it). */
  total: number;
}

export interface ClaimResponse {
  results: FinishResult[];
}

export interface BoardRow {
  /** The run's game id: what the replay route reads. A finished game's id is safe to show (C4 decision 2). */
  id: string;
  rank: number;
  name: string;
  ms: number;
  finishedAt: number;
  /** One of the signed-in player's runs. */
  mine: boolean;
  /** The viewer may watch this run (canWatch); false for another player's Daily run while its day is open. */
  replay: boolean;
}

/** GET /api/board: every number is the window's (its runs, ranks among them, your best in it). */
export interface BoardResponse {
  /** The top BOARD_TOP runs. */
  rows: BoardRow[];
  /** Ranked runs on the board. */
  total: number;
  /** Your best run's row when it is outside the top BOARD_TOP; null with no run in the window. */
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
  /** Imported from a device's pre-accounts stats (spec 2026-10-08), not played on Aglow. */
  imported: boolean;
  /** A Daily Tree run's day (YYYY-MM-DD); null for a random game. A past day's tree is known by its reason, 'past'. */
  daily: string | null;
  /** This game is the owner's earliest-started live game for its day (finished or not); false for a repeat or a random game. */
  dailyFirst: boolean;
  /** The run kept a log, so it can be watched; false for an imported run. */
  replay: boolean;
}

export interface MyGamesResponse {
  best: { ms: number; rank: number | null; finishedAt: number } | null;
  /** How many of the top BOARD_TOP runs are yours. */
  inTop: number;
  total: number;
  /** The last 30 finished games, newest first. */
  games: RecentGame[];
}

/** The flag bits of a CareerRow. */
export const CAREER_IMPORTED = 1;
export const CAREER_REPLAY = 2;
export const CAREER_PAST = 4;

/** One finished run: [id, finishedAt, ms, turns, minTurns, flags, reason, dailyDay]. flags: 1 imported, 2 has a log (Watch), 4 a past day's Daily. */
export type CareerRow = [string, number, number, number | null, number | null, number, UnrankedReason | null, string | null];

export interface CareerResponse {
  /** Every finished run of the account, oldest first. */
  runs: CareerRow[];
  /** The ranked best (bestOf), its board place (null without a name) and the board's size; null with no ranked run. */
  best: { id: string; ms: number; rank: number | null } | null;
  /** How many of the top BOARD_TOP are the account's. */
  inTop: number;
  total: number;
}

/** A finished run's tree and log: what plays it back (the replay, or a ghost). */
export interface GhostRun {
  seed: number;
  genVersion: number;
  log: LogEntry[];
  ms: number;
}

/** GET /api/me/ghost?day=: your fastest run on that day's tree, or null when you have none to race. */
export interface GhostResponse {
  ghost: GhostRun | null;
}

/** GET /api/games/:id/replay: a finished run the viewer may watch, and who played it. */
export interface ReplayResponse extends GhostRun {
  id: string;
  /** The owner's display name. */
  name: string | null;
  /** The viewer is the owner. */
  mine: boolean;
  finishedAt: number;
  /** A Daily Tree run's day (YYYY-MM-DD); null for a random game. */
  daily: string | null;
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

/**
 * POST /api/admin/import's answer.
 *
 * When `already` is true, `streak`, `longestStreak` and `clamped` describe the request just sent, not the runs that
 * were stored earlier (the route never reads them back): ignore them.
 */
export interface ImportResponse {
  /** Runs inserted (0 when this importId was imported before). */
  added: number;
  already: boolean;
  /** What the dates show: the request's streaks, or less when they didn't fit between 2026-09-29 and the last day. */
  streak: number;
  longestStreak: number;
  clamped: boolean;
}

/** GET /api/me/stats (spec 2026-10-08 §3.2): the account's stats, the same on every device. */
export interface AccountStats {
  /** The signed-in account's id: the client keys its per-device stats baseline (spec §6.2) by it. */
  userId: number;
  /** Finished games, any ranked state, imported ones included. */
  solved: number;
  totalMs: number;
  /** round(totalMs / solved); null with no game. */
  averageMs: number | null;
  /** The best ranked run (the board's "your best"); null with none. */
  bestMs: number | null;
  /** Consecutive local days ending today or yesterday; 0 otherwise. */
  streak: number;
  longestStreak: number;
  /** The last local day with a finish, YYYY-MM-DD. */
  lastSolvedDay: string | null;
  /** How many of `solved` were imported. */
  imported: number;
}

/** GET /api/me/progress (season two C2+C3): what the account has earned, evaluated from its rows on the server. */
export interface ProgressResponse {
  earned: ItemId[];
  goals: Record<GoalId, GoalState>;
  /** Finished games, any source: the client shows the larger of this and the device's own count. */
  treesLit: number;
}
