import type { FinishResult } from '../api/types';
import { computeLighting, type Board, type BoardState } from '../core/board';
import { parseLog, type LogEntry } from '../core/log';
import type { Grid } from '../core/mask';
import { orientationsOf } from '../core/scramble';
import { isSeed } from '../core/seeded';
import { readJSON, removeKey, writeJSON } from './storage';

/** The server game behind the tree on screen. null: a local, unranked ("offline") tree. */
export interface OnlineRun {
  gameId: string;
  seed: number;
  genVersion: number;
  /** Signed-out games only: proves ownership when the run is claimed after sign-in. */
  claim: string | null;
}

/** A solved tree whose run still matters: what its results tag shows, and the server's answer once there is one. */
export interface WonRun {
  seconds: number;
  score: number;
  newBest: boolean;
  result: FinishResult | null;
  /** The finish was (re)sent too long after the win for the server's clock to vouch for it: kept, unranked 'clock'. */
  late?: boolean;
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
  log: LogEntry[];
  won: WonRun | null;
}

const KEY = 'aglow.game';
const RETURN_KEY = 'aglow.return';
const GAME_ID = /^[A-Za-z0-9_-]{16,64}$/;
const REASONS: readonly unknown[] = ['anonymous', 'paused', 'too_fast', 'clock'];

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
    log: [...snap.log],
    won: snap.won,
  };
  writeJSON(KEY, saved);
}

export const clearGame = (): void => removeKey(KEY);

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown): boolean => x === null || num(x);

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
    typeof r.newBest === 'boolean'
  );
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
    (w.late === undefined || typeof w.late === 'boolean')
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
      const online =
        typeof o.gameId === 'string' && GAME_ID.test(o.gameId) && isSeed(o.seed) && Number.isInteger(o.genVersion) && (o.claim === null || typeof o.claim === 'string');
      const offline = o.gameId === null && o.seed === null && o.genVersion === null && o.claim === null;
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
  const online = s.gameId !== null && s.seed !== null && s.genVersion !== null ? { gameId: s.gameId, seed: s.seed, genVersion: s.genVersion, claim: s.claim } : null;
  return { state, elapsedMs: s.elapsedMs, startEpoch: s.startEpoch, online, log: s.log, won: s.won };
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
