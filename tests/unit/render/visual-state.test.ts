import { describe, expect, it } from 'vitest';
import { Board } from '../../../src/core/board';
import { degree } from '../../../src/core/dirs';
import { generateSolution } from '../../../src/core/generate';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { FADE_MS, TILE_FILL_MS, VisualState } from '../../../src/render/visual-state';

const solution = generateSolution(GRID, mulberry32(11));
const solved = () => new Board(GRID, { solution: [...solution], bits: [...solution], colors: solution.map(() => 0) });

describe('VisualState flow timing', () => {
  it('chains each newly lit tile TILE_FILL_MS after its parent', () => {
    const b = solved();
    const v = new VisualState(GRID.w * GRID.h);
    v.onLightingChanged(b, b.lighting.order, [], 1000, true);
    expect(v.litStart[GRID.root]).toBe(1000);
    for (const i of b.lighting.order) {
      const p = b.lighting.parent[i];
      if (p >= 0) expect(v.litStart[i]).toBe(v.litStart[p] + TILE_FILL_MS);
    }
  });
  it('flashes only where a newly lit subtree joins', () => {
    const b = solved();
    const v = new VisualState(GRID.w * GRID.h);
    v.onLightingChanged(b, b.lighting.order, [], 0, true);
    expect(v.flashes).toHaveLength(1);
    expect(v.flashes[0].tile).toBe(GRID.root);
  });
  it('returns sorted bulb-pop times for every newly lit end tile', () => {
    const b = solved();
    const v = new VisualState(GRID.w * GRID.h);
    const pops = v.onLightingChanged(b, b.lighting.order, [], 0, false);
    const ends = GRID.ids.filter((i) => degree(solution[i]) === 1);
    expect(pops).toHaveLength(ends.length);
    const times = pops.map((p) => p.at);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(v.flashes).toHaveLength(0);
  });
  it('returns the tile alongside each bulb-pop time', () => {
    const b = solved();
    const v = new VisualState(GRID.w * GRID.h);
    const pops = v.onLightingChanged(b, b.lighting.order, [], 500, false);
    const ends = GRID.ids.filter((i) => degree(solution[i]) === 1);
    expect(pops.map((p) => p.tile).sort((x, y) => x - y)).toEqual(ends);
    for (const p of pops) expect(p.at).toBe(v.litStart[p.tile] + TILE_FILL_MS);
  });
  it('fills, then fades lost tiles over FADE_MS', () => {
    const b = solved();
    const v = new VisualState(GRID.w * GRID.h);
    v.onLightingChanged(b, b.lighting.order, [], 0, false);
    expect(v.fill(b, GRID.root, TILE_FILL_MS / 2)).toEqual({ q: 0.5, alpha: 1 });
    const ev = b.tap(GRID.root, 100);
    const lost = ev.flatMap((e) => (e.type === 'lightingChanged' ? e.lost : []));
    v.onLightingChanged(b, [], lost, 100, false);
    expect(v.fill(b, GRID.root, 150)).toEqual({ q: 0, alpha: 0 }); // turning tile is dark
    const child = b.lighting.order[0] ?? lost[1];
    expect(v.fill(b, child, 100 + FADE_MS / 2).alpha).toBeCloseTo(0.5);
  });
  it('drops the leftover fade of a tile that finishes its turn unpowered (no ghost glow)', () => {
    const b = solved();
    const v = new VisualState(GRID.w * GRID.h);
    v.onLightingChanged(b, b.lighting.order, [], 0, false);
    const t = GRID.ids.find((i) => i !== GRID.root && degree(solution[i]) === 1)!;
    const lost = b.tap(t, 1000).flatMap((e) => (e.type === 'lightingChanged' ? e.lost : []));
    v.onLightingChanged(b, [], lost, 1000, false);
    b.tick(1000 + b.rotateMs); // one turn off the solution: the tile stays dark
    expect(b.lighting.lit[t]).toBe(false);
    v.onRotateFinished(b, t, 1000 + b.rotateMs);
    expect(v.fill(b, t, 1000 + b.rotateMs + 10)).toEqual({ q: 0, alpha: 0 });
  });
  it('bounces a settled tile and returns to 1', () => {
    const v = new VisualState(GRID.w * GRID.h);
    v.onRotateFinished(solved(), 5, 1000);
    expect(v.settleScale(5, 1000 + 60)).toBeGreaterThan(1);
    expect(v.settleScale(5, 2000)).toBe(1);
  });
});

describe('VisualState.hurry', () => {
  it('hurry: tiles still to light come four times sooner; lit ones are untouched', () => {
    const v = new VisualState(4);
    v.litStart.splice(0, 4, 100, 1000, 1400, -1);
    v.hurry(1000, 4);
    expect(v.litStart).toEqual([100, 1000, 1100, -1]);
  });
});
