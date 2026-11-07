import { describe, expect, it } from 'vitest';
import { ghostTrack } from '../../../src/core/ghost';
import { judge } from '../../../src/core/judge';
import { GRID } from '../../../src/core/mask';
import { Playback } from '../../../src/core/playback';
import { replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { shortestTaps, withPause } from './solver';

const fresh = (seed: number, headless = false) => {
  const b = seededBoard(seed, GEN_VERSION, headless);
  if (!b) throw new Error('no board');
  return b;
};

const source = (seed: number) => {
  const log = withPause(withPause(shortestTaps(fresh(seed)), 9, 3000), 40, 120_000);
  const solvedAt = replay(fresh(seed, true), log)?.solvedAt ?? 0;
  const verdict = judge({ seed, genVersion: GEN_VERSION, log, serverElapsedMs: solvedAt });
  return { seed, genVersion: GEN_VERSION, log, ms: verdict?.ms ?? 0 };
};

describe('ghostTrack', () => {
  it('starts at the tree’s lit count and ends with every tile lit at its ms', () => {
    for (const seed of [1, 2, 3]) {
      const run = source(seed);
      const track = ghostTrack(run);
      expect(track).not.toBeNull();
      expect(track?.ms).toBe(run.ms);
      expect(track?.litAt(0)).toBe(fresh(seed).lighting.count);
      expect(track?.litAt(track.ms)).toBe(GRID.ids.length);
      expect(track?.litAt(track.ms + 10_000)).toBe(GRID.ids.length);
      expect(track?.tilesAt(track.ms).size).toBe(GRID.ids.length);
    }
  });

  it('agrees with a Playback at 20 clock values across the run', () => {
    for (const seed of [1, 2]) {
      const run = source(seed);
      const track = ghostTrack(run);
      if (!track) throw new Error('no track');
      const marks = Array.from({ length: 20 }, (_, k) => Math.floor((track.ms * k) / 19));
      for (const c of marks) {
        const board = fresh(seed);
        const pb = new Playback(board, run.log);
        while (!pb.ended && pb.clockMs() < c) pb.step(1, 1);
        expect(pb.clockMs()).toBe(c);
        expect(track.litAt(c), `seed ${seed} clock ${c}`).toBe(board.lighting.count);
        expect([...track.tilesAt(c)].sort((a, b) => a - b)).toEqual([...board.lighting.order].sort((a, b) => a - b));
      }
    }
  });

  it('hands back the same set until the lit tiles change', () => {
    const track = ghostTrack(source(1));
    if (!track) throw new Error('no track');
    expect(track.tilesAt(track.ms)).toBe(track.tilesAt(track.ms + 500));
    expect(track.tilesAt(0)).toBe(track.tilesAt(1));
  });

  it('is null for a log that never solves', () => {
    const run = source(1);
    expect(ghostTrack({ ...run, log: run.log.slice(0, -1) })).toBeNull();
    expect(ghostTrack({ ...run, log: [] })).toBeNull();
  });

  it('is null for a tree it cannot make', () => {
    const run = source(1);
    expect(ghostTrack({ ...run, genVersion: 999 })).toBeNull();
  });
});
