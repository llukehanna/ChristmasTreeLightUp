import { describe, expect, it } from 'vitest';
import { Board, MAX_QUEUE, ROTATE_MS, computeLighting, type BoardEvent } from '../../../src/core/board';
import { U, degree, rotCW } from '../../../src/core/dirs';
import { generateSolution } from '../../../src/core/generate';
import { GRID, neighbor } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';

const solution = generateSolution(GRID, mulberry32(42));
const colors = solution.map(() => 0);
const solved = () => new Board(GRID, { solution: [...solution], bits: [...solution], colors });
const endTile = () => GRID.ids.find((i) => i !== GRID.root && degree(solution[i]) === 1)!;
type Lit = Extract<BoardEvent, { type: 'lightingChanged' }>;
const lightingOf = (ev: BoardEvent[]) => ev.find((e): e is Lit => e.type === 'lightingChanged');

describe('Board lighting', () => {
  it('lights every tile when solved', () => {
    expect(solved().lighting.count).toBe(97);
  });
  it('records BFS parents and entry directions', () => {
    const { lighting } = solved();
    for (const i of lighting.order) {
      if (i === GRID.root) continue;
      expect(neighbor(GRID, i, lighting.entry[i] as 1 | 2 | 4 | 8)).toBe(lighting.parent[i]);
    }
  });
  it('lights nothing when the root has no down link', () => {
    const bits = [...solution];
    bits[GRID.root] = U;
    expect(computeLighting(GRID, bits).count).toBe(0);
  });
});

describe('Board rotation', () => {
  it('darkens a turning tile and everything downstream', () => {
    const b = solved();
    const ev = b.tap(GRID.root, 0);
    expect(ev[0]).toEqual({ type: 'rotateStarted', tile: GRID.root });
    expect(b.bits[GRID.root]).toBe(0);
    expect(b.lighting.count).toBe(0);
    expect(lightingOf(ev)?.lost).toHaveLength(97);
  });
  it('finishes a clockwise turn after ROTATE_MS', () => {
    const b = solved();
    const t = endTile();
    b.tap(t, 0);
    expect(b.tick(ROTATE_MS - 1)).toEqual([]);
    const ev = b.tick(ROTATE_MS);
    expect(ev[0]).toEqual({ type: 'rotateFinished', tile: t });
    expect(b.bits[t]).toBe(rotCW(solution[t]));
    expect(b.displayBits(t)).toBe(rotCW(solution[t]));
  });
  it('chains buffered taps into one spin and stays dark throughout', () => {
    const b = solved();
    const t = endTile();
    b.tap(t, 0);
    for (const now of [10, 20, 30]) expect(b.tap(t, now)).toEqual([{ type: 'tapBuffered', tile: t }]);
    expect(b.tap(t, 40)).toEqual([]); // beyond the cap: dropped, so no tick or buzz
    expect(b.rotating.get(t)?.queued).toBe(MAX_QUEUE);
    for (const now of [120, 240, 360]) {
      b.tick(now);
      expect(b.bits[t]).toBe(0);
      expect(b.lighting.lit[t]).toBe(false);
    }
    b.tick(480);
    expect(b.bits[t]).toBe(solution[t]); // four clockwise turns
    expect(b.rotating.size).toBe(0);
  });
  it('reports settled bits for tiles mid-spin (for saving)', () => {
    const b = solved();
    const t = endTile();
    b.tap(t, 0);
    b.tap(t, 10);
    expect(b.settledBits()[t]).toBe(rotCW(rotCW(solution[t])));
  });
});

describe('Board win', () => {
  it('wins when the last tile clicks into place, then ignores taps', () => {
    const t = endTile();
    const bits = [...solution];
    bits[t] = rotCW(solution[t]);
    const b = new Board(GRID, { solution: [...solution], bits, colors });
    expect(b.won).toBe(false);
    b.tap(t, 0);
    b.tick(120);
    b.tap(t, 130);
    b.tick(250);
    b.tap(t, 260);
    const ev = b.tick(380);
    expect(ev.map((e) => e.type)).toContain('won');
    expect(b.won).toBe(true);
    expect(b.tap(t, 400)).toEqual([]);
  });
  it('settleWin claims the win for a board restored already solved, once', () => {
    const b = solved();
    expect(b.won).toBe(false); // the constructor never checks for a win
    expect(b.settleWin()).toEqual([{ type: 'won' }]);
    expect(b.won).toBe(true);
    expect(b.settleWin()).toEqual([]);
  });
  it('settleWin does nothing for an unsolved board', () => {
    const t = endTile();
    const bits = [...solution];
    bits[t] = rotCW(solution[t]);
    const b = new Board(GRID, { solution: [...solution], bits, colors });
    expect(b.settleWin()).toEqual([]);
    expect(b.won).toBe(false);
  });
  it('debugSolve lights everything and wins', () => {
    const b = Board.random(GRID, mulberry32(9));
    const ev = b.debugSolve();
    expect(b.lighting.count).toBe(97);
    expect(ev.map((e) => e.type)).toContain('won');
  });
});
