// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { degree, rotCW } from '../../../src/core/dirs';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { clearGame, loadGame, markReturn, saveGame, savesAtStart, takeReturn, type GameSnapshot } from '../../../src/store/progress';

const SNAP: GameSnapshot = { startEpoch: 0, online: null, log: [], won: null };

beforeEach(() => localStorage.clear());

it('saves and restores an in-progress game', () => {
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 42_000, SNAP);
  const got = loadGame(GRID);
  expect(got?.elapsedMs).toBe(42_000);
  expect(got?.state.bits).toEqual(b.bits);
  expect(got?.state.solution).toEqual([...b.solution]);
  expect(got?.state.colors).toEqual(b.colors);
});

it('saves the settled orientation of a tile that is mid-turn', () => {
  const b = Board.random(GRID, mulberry32(4));
  const t = GRID.ids[10];
  const before = b.bits[t];
  b.tap(t, 0);
  saveGame(b, 0, SNAP);
  expect(loadGame(GRID)?.state.bits[t]).toBe(rotCW(before));
});

it('discards tampered or corrupt saves', () => {
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 1000, SNAP);
  const raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.bits[GRID.root] = 0; // not a valid orientation
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();
  clearGame();
  expect(loadGame(GRID)).toBeNull();
});

it('validates all mutations: wrong array length, invalid color, wrong version, negative time, broken solution', () => {
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 1000, SNAP);
  const n = GRID.w * GRID.h;

  // Mutation: wrong array length (bits.pop())
  let raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.bits.pop();
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: nonzero value on non-tile index
  saveGame(b, 1000, SNAP);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  for (let i = 0; i < n; i++) {
    if (!GRID.cells[i]) {
      raw.bits[i] = 1; // nonzero on non-tile
      localStorage.setItem('aglow.game', JSON.stringify(raw));
      expect(loadGame(GRID)).toBeNull();
      raw.bits[i] = 0; // restore
    }
  }

  // Mutation: colors out of range
  saveGame(b, 1000, SNAP);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  const tileIdx = GRID.ids[0];
  raw.colors[tileIdx] = 6;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: v = 3
  saveGame(b, 1000, SNAP);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.v = 3;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: elapsedMs = -1
  saveGame(b, 1000, SNAP);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.elapsedMs = -1;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Positive control: same data loads before connectivity mutation
  saveGame(b, 1000, SNAP);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  expect(loadGame(GRID)).not.toBeNull();

  // Mutation: solution doesn't light every tile (rotate end tile to break connectivity)
  saveGame(b, 1000, SNAP);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  const endTile = GRID.ids.find((i) => i !== GRID.root && degree(raw.solution[i]) === 1);
  if (endTile !== undefined) {
    raw.solution[endTile] = rotCW(raw.solution[endTile]);
    raw.bits[endTile] = raw.solution[endTile];
    localStorage.setItem('aglow.game', JSON.stringify(raw));
    expect(loadGame(GRID)).toBeNull();
  }
});

it('v2 keeps the online run, its log and a won run', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: 'c'.repeat(32), daily: null };
  const log = [{ t: 10, a: GRID.ids[0] }, { t: 20, a: 'p' as const }];
  const won = {
    seconds: 81,
    score: 41_900,
    newBest: true,
    result: { id: 'g'.repeat(22), ranked: false, reason: 'anonymous' as const, ms: 80_400, rank: 3, total: 10, best: null, newBest: false, daily: null },
  };
  saveGame(b, 5000, { startEpoch: 123, online, log, won });
  expect(loadGame(GRID)).toEqual({ state: { solution: [...b.solution], bits: b.bits, colors: [...b.colors] }, elapsedMs: 5000, startEpoch: 123, online, log, won });
});

it('a won run sent too late keeps saying so after a reload', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: null };
  const won = { seconds: 81, score: 41_900, newBest: false, result: null, late: true };
  saveGame(b, 5000, { startEpoch: 123, online, log: [], won });
  expect(loadGame(GRID)?.won).toEqual(won);
});

it('a save from before accounts (v1) restores as a local tree', () => {
  const b = Board.random(GRID, mulberry32(4));
  localStorage.setItem('aglow.game', JSON.stringify({ v: 1, solution: b.solution, bits: b.bits, colors: b.colors, elapsedMs: 9000 }));
  expect(loadGame(GRID)).toMatchObject({ elapsedMs: 9000, online: null, log: [], won: null });
});

it('refuses a v2 save with a bad log, half an online run or a malformed result', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: null };
  const mutations: ((raw: Record<string, unknown>) => void)[] = [
    (raw) => (raw.log = [{ t: 5, a: 'r' }]),
    (raw) => (raw.seed = null),
    (raw) => (raw.gameId = 'short'),
    (raw) => (raw.won = { seconds: 1, score: 1, newBest: false, result: { id: 'x' } }),
    (raw) => (raw.won = { seconds: 1, score: 1, newBest: false, result: null, late: 'yes' }),
    (raw) => (raw.startEpoch = 'soon'),
  ];
  for (const mutate of mutations) {
    saveGame(b, 1000, { startEpoch: 1, online, log: [], won: null });
    const raw = JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as Record<string, unknown>;
    mutate(raw);
    localStorage.setItem('aglow.game', JSON.stringify(raw));
    expect(loadGame(GRID)).toBeNull();
  }
});

it('a saved Daily game restores its daily info', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: { day: '2026-11-06', past: false, repeat: false } };
  saveGame(b, 5000, { startEpoch: 123, online, log: [], won: null });
  expect(loadGame(GRID)?.online).toEqual(online);
});

it('a save from before C1 restores with daily null', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: null };
  saveGame(b, 5000, { startEpoch: 123, online, log: [], won: null });
  const raw = JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as Record<string, unknown>;
  delete raw.daily;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)?.online).toEqual(online);
});

it('a saved won Daily run (reason daily, with daily info) restores', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: 'c'.repeat(32), daily: { day: '2026-11-06', past: false, repeat: false } };
  const result = {
    id: 'g'.repeat(22), ranked: false, reason: 'daily' as const, ms: 80_400, rank: null, total: 10, best: null, newBest: false,
    daily: { day: '2026-11-06', past: false, first: true, rank: 2, total: 5 },
  };
  const won = { seconds: 81, score: 41_900, newBest: false, result };
  saveGame(b, 5000, { startEpoch: 123, online, log: [], won });
  expect(loadGame(GRID)?.won).toEqual(won);
  // A past day's run restores too.
  const past = { ...won, result: { ...result, reason: 'past' as const, daily: { ...result.daily, past: true, first: false, rank: null } } };
  saveGame(b, 5000, { startEpoch: 123, online: { ...online, daily: { day: '2026-11-02', past: true, repeat: false } }, log: [], won: past });
  expect(loadGame(GRID)?.won).toEqual(past);
});

it('a saved result from before C1 (no daily) restores with daily null', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: null };
  const won = { seconds: 81, score: 41_900, newBest: false, result: { id: 'g'.repeat(22), ranked: true, reason: null, ms: 80_400, rank: 3, total: 10, best: 80_400, newBest: true, daily: null } };
  saveGame(b, 5000, { startEpoch: 123, online, log: [], won });
  const raw = JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as { won: { result: Record<string, unknown> } };
  delete raw.won.result.daily;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)?.won).toEqual(won);
});

it('refuses a malformed daily', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: null };
  for (const daily of [{ day: 'soon', past: false, repeat: false }, { day: '2026-11-06', past: 'no', repeat: false }, 'x']) {
    saveGame(b, 1000, { startEpoch: 1, online, log: [], won: null });
    const raw = JSON.parse(localStorage.getItem('aglow.game') ?? '{}') as Record<string, unknown>;
    raw.daily = daily;
    localStorage.setItem('aglow.game', JSON.stringify(raw));
    expect(loadGame(GRID)).toBeNull();
  }
});

it('a Daily tree begun with no move is restorable (saved from its start: a reload is not a new attempt)', () => {
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null, daily: { day: '2026-11-06', past: false, repeat: false } };
  expect(savesAtStart(online)).toBe(true);
  // A random tree, online or local, still waits for the first move.
  expect(savesAtStart({ ...online, daily: null })).toBe(false);
  expect(savesAtStart(null)).toBe(false);
  // Just begun: no time on the clock, nothing in the log.
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 0, { startEpoch: 123, online, log: [], won: null });
  expect(loadGame(GRID)).toMatchObject({ elapsedMs: 0, startEpoch: 123, online, log: [], won: null });
});

it('the return marker comes back once', () => {
  markReturn('g'.repeat(22));
  expect(takeReturn()).toBe('g'.repeat(22));
  expect(takeReturn()).toBeNull();
});
