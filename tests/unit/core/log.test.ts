import { describe, expect, it } from 'vitest';
import { endsPaused, GameLog, MAX_LOG_ENTRIES, MAX_LOG_MS, parseLog } from '../../../src/core/log';
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

describe('GameLog', () => {
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
