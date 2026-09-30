// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { rotCW } from '../../../src/core/dirs';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { clearGame, loadGame, saveGame } from '../../../src/store/progress';

beforeEach(() => localStorage.clear());

it('saves and restores an in-progress game', () => {
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 42_000);
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
  saveGame(b, 0);
  expect(loadGame(GRID)?.state.bits[t]).toBe(rotCW(before));
});

it('discards tampered or corrupt saves', () => {
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 1000);
  const raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.bits[GRID.root] = 0; // not a valid orientation
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();
  clearGame();
  expect(loadGame(GRID)).toBeNull();
});

it('validates all mutations: wrong array length, invalid color, wrong version, negative time, broken solution', () => {
  const b = Board.random(GRID, mulberry32(4));
  saveGame(b, 1000);
  const n = GRID.w * GRID.h;

  // Mutation: wrong array length (bits.pop())
  let raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.bits.pop();
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: nonzero value on non-tile index
  saveGame(b, 1000);
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
  saveGame(b, 1000);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  const tileIdx = GRID.ids[0];
  raw.colors[tileIdx] = 6;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: v = 2
  saveGame(b, 1000);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.v = 2;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: elapsedMs = -1
  saveGame(b, 1000);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.elapsedMs = -1;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();

  // Mutation: solution doesn't light every tile (set solution to 0, breaking connectivity)
  saveGame(b, 1000);
  raw = JSON.parse(localStorage.getItem('aglow.game')!);
  raw.solution[GRID.root] = 0;
  localStorage.setItem('aglow.game', JSON.stringify(raw));
  expect(loadGame(GRID)).toBeNull();
});
