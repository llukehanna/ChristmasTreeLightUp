import type { DailyInfo, DailyResult, FinishResult, RunContext } from '../api/types';
import { computeLighting, type Board, type BoardState } from '../core/board';
import { parseLog, type LogEntry } from '../core/log';
import type { Grid } from '../core/mask';
import { orientationsOf } from '../core/scramble';
import { isSeed } from '../core/seeded';
import { RETURN_KEY, readJSON, removeKey, writeJSON } from './storage';

/** The server game behind the tree on screen. null: a local, unranked ("offline") tree. */
export interface OnlineRun {
  gameId: string;
  seed: number;
  genVersion: number;
  /** Signed-out games only: proves ownership when the run is claimed after sign-in. */
  claim: string | null;
  /** Set when this is a Daily Tree game (today's or a past day's); null for a random game. */
  daily: DailyInfo | null;
}

/** A solved tree whose run still matters: what its results tag shows, and the server's answer once there is one. */
export interface WonRun {
  seconds: number;
  score: number;
  newBest: boolean;
  result: FinishResult | null;
  /** The finish was (re)sent too long after the win for the server's clock to vouch for it: kept, unranked 'clock'. */
  late?: boolean;
  /** `result` is the claim's answer for a run played signed out, no longer its finish's (a Daily result looks the same either way). */
  claimed?: boolean;
  /** The context at the win (zone, station, world), kept so a resend after a reload reports the same. */
  ctx?: RunContext;
}

export interface GameSnapshot {
  /** Date.now() when this tree began locally: log times count from here. */
  startEpoch: number;
  online: OnlineRun | null;
  log: readonly LogEntry[];
  won: WonRun | null;
}

export interface LoadedGame extends GameSnapshot {
  state: BoardState;
  elapsedMs: number;
  log: LogEntry[];
}

interface SavedV1 {
  v: 1;
  solution: number[];
  bits: number[];
  colors: number[];
  elapsedMs: number;
}

interface SavedV2 extends Omit<SavedV1, 'v'> {
  v: 2;
  startEpoch: number;
  gameId: string | null;
  seed: number | null;
  genVersion: number | null;
  claim: string | null;
  /** Absent in a save from before the Daily Tree: read as null. */
  daily?: DailyInfo | null;
  log: LogEntry[];
  won: WonRun | null;
}

const KEY = 'aglow.game';
const GAME_ID = /^[A-Za-z0-9_-]{16,64}$/;
const REASONS: readonly unknown[] = ['anonymous', 'paused', 'too_fast', 'clock', 'daily', 'past'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function saveGame(board: Board, elapsedMs: number, snap: GameSnapshot): void {
  const saved: SavedV2 = {
    v: 2,
    solution: [...board.solution],
    bits: board.settledBits(),
    colors: [...board.colors],
    elapsedMs: Math.round(elapsedMs),
    startEpoch: snap.startEpoch,
    gameId: snap.online?.gameId ?? null,
    seed: snap.online?.seed ?? null,
    genVersion: snap.online?.genVersion ?? null,
    claim: snap.online?.claim ?? null,
    daily: snap.online?.daily ?? null,
    log: [...snap.log],
    won: snap.won,
  };
  writeJSON(KEY, saved);
}

export const clearGame = (): void => removeKey(KEY);

/**
 * A Daily tree is saved from the moment it begins, so a reload before the first move resumes the same game (the attempt
 * is spent at the start: a reload is never a new one). A random tree still waits for the first move.
 */
export const savesAtStart = (online: OnlineRun | null): boolean => online?.daily != null;

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown): boolean => x === null || num(x);

const isDay = (x: unknown): x is string => typeof x === 'string' && DAY.test(x);

function isDailyInfo(v: unknown): v is DailyInfo {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return isDay(d.day) && typeof d.past === 'boolean' && typeof d.repeat === 'boolean';
}

function isDailyResult(v: unknown): v is DailyResult {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return isDay(d.day) && typeof d.past === 'boolean' && typeof d.first === 'boolean' && numOrNull(d.rank) && num(d.total);
}

/** A saved result; one from before the Daily Tree has no `daily` (loadGame reads it as null). */
function isFinishResult(v: unknown): v is FinishResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.ranked === 'boolean' &&
    (r.reason === null || REASONS.includes(r.reason)) &&
    num(r.ms) &&
    numOrNull(r.rank) &&
    num(r.total) &&
    numOrNull(r.best) &&
    typeof r.newBest === 'boolean' &&
    (r.daily === undefined || r.daily === null || isDailyResult(r.daily))
  );
}

const WORLDS: readonly unknown[] = [null, 'secret', 'home-alone'];

function isRunContext(v: unknown): v is RunContext {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return num(c.tz) && (c.station === null || typeof c.station === 'string') && WORLDS.includes(c.world);
}

function isWon(v: unknown): v is WonRun {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  return (
    Number.isInteger(w.seconds) &&
    (w.seconds as number) >= 0 &&
    Number.isInteger(w.score) &&
    typeof w.newBest === 'boolean' &&
    (w.result === null || isFinishResult(w.result)) &&
    (w.late === undefined || typeof w.late === 'boolean') &&
    (w.claimed === undefined || typeof w.claimed === 'boolean') &&
    (w.ctx === undefined || isRunContext(w.ctx))
  );
}

/** Validates a save against the mask: right sizes, legal orientations, a solution that lights every tile; v2 adds the run. */
function validator(g: Grid) {
  return (v: unknown): v is SavedV1 | SavedV2 => {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    const n = g.w * g.h;
    const isArr = (x: unknown): x is number[] => Array.isArray(x) && x.length === n && x.every((e) => Number.isInteger(e));
    if ((o.v !== 1 && o.v !== 2) || !isArr(o.solution) || !isArr(o.bits) || !isArr(o.colors)) return false;
    if (typeof o.elapsedMs !== 'number' || !Number.isFinite(o.elapsedMs) || o.elapsedMs < 0) return false;
    if (o.v === 2) {
      if (!num(o.startEpoch) || parseLog(o.log, g) === null || !(o.won === null || isWon(o.won))) return false;
      const noDaily = o.daily === undefined || o.daily === null;
      const online =
        typeof o.gameId === 'string' && GAME_ID.test(o.gameId) && isSeed(o.seed) && Number.isInteger(o.genVersion) && (o.claim === null || typeof o.claim === 'string') &&
        (noDaily || isDailyInfo(o.daily));
      const offline = o.gameId === null && o.seed === null && o.genVersion === null && o.claim === null && noDaily;
      if (!online && !offline) return false;
    }
    const solution = o.solution as number[];
    const bits = o.bits as number[];
    const colors = o.colors as number[];
    for (let i = 0; i < n; i++) {
      if (!g.cells[i]) {
        if (solution[i] !== 0 || bits[i] !== 0) return false;
        continue;
      }
      try {
        if (!orientationsOf(solution[i]).includes(bits[i])) return false;
      } catch {
        return false;
      }
      if (colors[i] < 0 || colors[i] > 5) return false;
    }
    return computeLighting(g, solution).count === g.ids.length;
  };
}

export function loadGame(g: Grid): LoadedGame | null {
  const s = readJSON(KEY, validator(g));
  if (!s) return null;
  const state: BoardState = { solution: s.solution, bits: s.bits, colors: s.colors };
  // A save from before accounts restores, as a local tree.
  if (s.v === 1) return { state, elapsedMs: s.elapsedMs, startEpoch: Date.now() - s.elapsedMs, online: null, log: [], won: null };
  const online =
    s.gameId !== null && s.seed !== null && s.genVersion !== null ? { gameId: s.gameId, seed: s.seed, genVersion: s.genVersion, claim: s.claim, daily: s.daily ?? null } : null;
  // A result saved before the Daily Tree has no `daily`.
  const won = s.won?.result ? { ...s.won, result: { ...s.won.result, daily: s.won.result.daily ?? null } } : s.won;
  return { state, elapsedMs: s.elapsedMs, startEpoch: s.startEpoch, online, log: s.log, won };
}

/** "Save to leaderboard": after the round trip to Google, this run's results tag comes back (spec §6). */
export function markReturn(gameId: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, gameId);
  } catch {
    // storage blocked: the results tag just doesn't come back
  }
}

/** The run to come back to, once: reading it clears it. */
export function takeReturn(): string | null {
  try {
    const id = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return id;
  } catch {
    return null;
  }
}
