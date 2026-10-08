import type { UnrankedReason } from '../core/judge';

/** JSON shapes shared by the Worker and the browser (spec 2026-10-07 §3). Types only, plus one constant. */
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
