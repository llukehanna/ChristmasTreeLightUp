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
