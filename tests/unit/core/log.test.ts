import { describe, expect, it } from 'vitest';
import { endsPaused, GameLog, MAX_LOG_ENTRIES, MAX_LOG_MS, parseLog, tapOf } from '../../../src/core/log';
import { GRID } from '../../../src/core/mask';

describe('parseLog', () => {
  const tile = GRID.ids[0];
  it('accepts a well-formed log', () => {
    const log = [{ t: 0, a: tile }, { t: 5, a: 'p' }, { t: 9, a: 'r' }, { t: 9, a: GRID.ids[1] }];
    expect(parseLog(log, GRID)).toEqual(log);
    expect(parseLog([], GRID)).toEqual([]);
    expect(parseLog(Array.from({ length: MAX_LOG_ENTRIES }, () => ({ t: 0, a: tile })), GRID)).not.toBeNull();
  });

  it('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      {},
      'x',
      [null],
      [{ t: 0 }],
      [{ t: 0, a: 'x' }],
      [{ t: -1, a: tile }],
      [{ t: 1.5, a: tile }],
      [{ t: '1', a: tile }],
      [{ t: 5, a: tile }, { t: 4, a: tile }], // time going backwards
      [{ t: MAX_LOG_MS + 1, a: tile }], // more than a day
      [{ t: 0, a: 0 }], // the top-left corner is not a tile
      [{ t: 0, a: GRID.cells.length }],
      [{ t: 0, a: 1.5 }],
      [{ t: 0, a: -1 }],
      [{ t: 0, a: 'r' }], // a resume without a pause
      [{ t: 0, a: 'p' }, { t: 1, a: 'p' }], // two pauses in a row
    ];
    for (const v of bad) expect(parseLog(v, GRID), JSON.stringify(v)).toBeNull();
    expect(parseLog(Array.from({ length: MAX_LOG_ENTRIES + 1 }, () => ({ t: 0, a: tile })), GRID)).toBeNull();
  });
});

describe('counter-clockwise taps: a = ~tile', () => {
  const tile = GRID.ids[0];
  it('parseLog accepts ~i when cell i is a tile, and keeps it as is', () => {
    expect(GRID.cells[tile]).toBe(true);
    const log = [{ t: 0, a: ~tile }, { t: 5, a: tile }, { t: 9, a: ~GRID.ids[1] }];
    expect(parseLog(log, GRID)).toEqual(log);
    expect(parseLog([{ t: 0, a: ~5 }], GRID)).toEqual(GRID.cells[5] ? [{ t: 0, a: ~5 }] : null);
  });
  it('parseLog refuses ~i when cell i is not a tile or not a cell', () => {
    const bad: unknown[] = [
      [{ t: 0, a: ~9999 }],
      [{ t: 0, a: ~GRID.cells.length }],
      [{ t: 0, a: ~0 }], // -1: the top-left corner is not a tile
      [{ t: 0, a: -1.5 }],
      [{ t: 0, a: -Infinity }],
      [{ t: 0, a: Number.MIN_SAFE_INTEGER }],
      [{ t: 0, a: -(2 ** 32) + ~tile }], // ~ works on 32 bits: this one would wrap round to ~tile
      [{ t: 0, a: 2 ** 32 + tile }],
    ];
    expect(~(-(2 ** 32) + ~tile)).toBe(tile);
    expect(GRID.cells[0]).toBe(false);
    for (const v of bad) expect(parseLog(v, GRID), JSON.stringify(v)).toBeNull();
  });
  it('tapOf decodes both directions', () => {
    expect(tapOf(tile)).toEqual({ tile, dir: 1 });
    expect(tapOf(~tile)).toEqual({ tile, dir: -1 });
    expect(tapOf(0)).toEqual({ tile: 0, dir: 1 });
    expect(tapOf(-1)).toEqual({ tile: 0, dir: -1 });
  });
  it('GameLog.tap records a counter-clockwise tap as ~tile, a clockwise one as the tile', () => {
    const log = new GameLog();
    log.tap(10, 5, -1);
    log.tap(11, 5, 1);
    log.tap(12, 5);
    expect(log.entries).toEqual([{ t: 10, a: ~5 }, { t: 11, a: 5 }, { t: 12, a: 5 }]);
    expect(log.entries[0].a).toBe(-6);
  });
});

describe('GameLog', () => {
  it('says when it has had to drop an entry at the cap (that run cannot verify)', () => {
    const log = new GameLog();
    for (let k = 0; k < MAX_LOG_ENTRIES; k++) log.tap(k, GRID.ids[0]);
    expect(log.overflowed).toBe(false);
    log.pause(MAX_LOG_ENTRIES);
    expect(log.overflowed).toBe(true);
    expect(log.entries).toHaveLength(MAX_LOG_ENTRIES);
    // A restored full log only overflows once something more is dropped.
    const restored = new GameLog(log.entries);
    expect(restored.overflowed).toBe(false);
    restored.tap(MAX_LOG_ENTRIES, GRID.ids[1]);
    expect(restored.overflowed).toBe(true);
  });

  it('records taps, pauses and resumes: rounded times that never go backwards, no taps while paused', () => {
    const log = new GameLog();
    log.tap(10.4, 7);
    log.pause(20.6);
    log.tap(25, 8);
    log.pause(26);
    log.resume(30);
    log.resume(31);
    log.tap(29, 9);
    expect(log.entries).toEqual([{ t: 10, a: 7 }, { t: 21, a: 'p' }, { t: 30, a: 'r' }, { t: 30, a: 9 }]);
  });

  it('continues a saved log, paused if it ended paused, without changing the saved array', () => {
    const saved = [{ t: 5, a: 7 }, { t: 9, a: 'p' as const }];
    const log = new GameLog(saved);
    expect(log.paused).toBe(true);
    log.tap(12, 8);
    log.resume(15);
    expect(log.entries).toEqual([{ t: 5, a: 7 }, { t: 9, a: 'p' }, { t: 15, a: 'r' }]);
    expect(saved).toHaveLength(2);
    expect(endsPaused([{ t: 1, a: 'p' }, { t: 2, a: 'r' }, { t: 3, a: 7 }])).toBe(false);
    expect(endsPaused([])).toBe(false);
  });

  it('keeps nothing past MAX_LOG_ENTRIES', () => {
    const log = new GameLog();
    for (let k = 0; k < MAX_LOG_ENTRIES + 3; k++) log.tap(k, 7);
    expect(log.entries).toHaveLength(MAX_LOG_ENTRIES);
  });
});
