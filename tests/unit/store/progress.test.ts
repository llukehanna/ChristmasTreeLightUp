// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { degree, rotCW } from '../../../src/core/dirs';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { clearGame, loadGame, markReturn, saveGame, takeReturn, type GameSnapshot } from '../../../src/store/progress';

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
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: 'c'.repeat(32) };
  const log = [{ t: 10, a: GRID.ids[0] }, { t: 20, a: 'p' as const }];
  const won = {
    seconds: 81,
    score: 41_900,
    newBest: true,
    result: { id: 'g'.repeat(22), ranked: false, reason: 'anonymous' as const, ms: 80_400, rank: 3, total: 10, best: null, newBest: false },
  };
  saveGame(b, 5000, { startEpoch: 123, online, log, won });
  expect(loadGame(GRID)).toEqual({ state: { solution: [...b.solution], bits: b.bits, colors: [...b.colors] }, elapsedMs: 5000, startEpoch: 123, online, log, won });
});

it('a save from before accounts (v1) restores as a local tree', () => {
  const b = Board.random(GRID, mulberry32(4));
  localStorage.setItem('aglow.game', JSON.stringify({ v: 1, solution: b.solution, bits: b.bits, colors: b.colors, elapsedMs: 9000 }));
  expect(loadGame(GRID)).toMatchObject({ elapsedMs: 9000, online: null, log: [], won: null });
});

it('refuses a v2 save with a bad log, half an online run or a malformed result', () => {
  const b = Board.random(GRID, mulberry32(4));
  const online = { gameId: 'g'.repeat(22), seed: 42, genVersion: 1, claim: null };
  const mutations: ((raw: Record<string, unknown>) => void)[] = [
    (raw) => (raw.log = [{ t: 5, a: 'r' }]),
    (raw) => (raw.seed = null),
    (raw) => (raw.gameId = 'short'),
    (raw) => (raw.won = { seconds: 1, score: 1, newBest: false, result: { id: 'x' } }),
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

it('the return marker comes back once', () => {
  markReturn('g'.repeat(22));
  expect(takeReturn()).toBe('g'.repeat(22));
  expect(takeReturn()).toBeNull();
});
