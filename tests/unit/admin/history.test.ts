// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exactMs, importDefaults, importPreview, importRequest, markDone, newImportId, parseClock, pendingMark, readMark, type ImportDefaults } from '../../../src/admin/history';
import type { ImportRequest } from '../../../src/api/types';
import { EMPTY_STATS, type Stats } from '../../../src/store/stats';

const device: Stats = { v: 1, solved: 40, totalSeconds: 3140, bestSeconds: 41, bestScore: 45900, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07' };

describe('parseClock', () => {
  it('reads m:ss and m:ss.t, to the ms', () => {
    expect(parseClock('0:41')).toBe(41_000);
    expect(parseClock(' 1:18.5 ')).toBe(78_500);
    expect(parseClock('1:18.45')).toBe(78_450);
    expect(parseClock('51:40.0')).toBe(3_100_000);
    for (const bad of ['', '78', '1:7', '1:60', '1:18.', '1:18.1234', 'a:bc']) expect(parseClock(bad)).toBeNull();
  });
});

describe('importDefaults', () => {
  it("fills the form from this device's stats, keeping the exact average behind its text", () => {
    expect(importDefaults(device)).toEqual({ averageMs: 78_500, fields: { solved: '40', best: '0:41', average: '1:18.5', streak: '3', longest: '5', lastDay: '2026-10-07' } });
  });
  it('none without a solved game', () => {
    expect(importDefaults(EMPTY_STATS)).toBeNull();
  });
});

describe('importRequest', () => {
  const d = importDefaults(device) as ImportDefaults;
  const req = (over: Partial<ImportDefaults['fields']> = {}) => importRequest({ ...d.fields, ...over }, d, 'AbCdEfGhIjKlMnOpQrStUv', 420, '2026-10-08');

  it('sends the numbers, with the exact average while its text is untouched', () => {
    expect(req()).toEqual({ importId: 'AbCdEfGhIjKlMnOpQrStUv', solved: 40, bestSeconds: 41, averageMs: 78_500, streak: 3, longestStreak: 5, lastSolvedDay: '2026-10-07', tz: 420 });
    expect(req({ solved: '35' })).toMatchObject({ solved: 35, averageMs: 78_500 });
    expect(req({ average: '1:20.25' })).toMatchObject({ averageMs: 80_250 });
    expect(req({ solved: '1' })).toMatchObject({ solved: 1, averageMs: 41_000 }); // one game: its time is the average
  });

  it.each([
    [{ solved: '0' }, 'Games solved'],
    [{ solved: '2001' }, 'Games solved'],
    [{ solved: '3.5' }, 'Games solved'],
    [{ best: '0:04' }, 'Best time'],
    [{ best: '0:41.5' }, 'Best time'],
    [{ best: '61:00' }, 'Best time'],
    [{ average: 'soon' }, 'Average time'],
    [{ average: '0:40.0' }, "can't be faster"],
    [{ streak: '0' }, 'Streaks'],
    [{ streak: '6' }, 'Streaks'],
    [{ lastDay: '2026-09-28' }, 'Last solved day'],
    [{ lastDay: '2026-10-09' }, 'Last solved day'],
  ])('refuses %o', (over, text) => {
    const r = req(over);
    expect(typeof r).toBe('string');
    expect(r).toContain(text);
  });
});

describe('the import mark', () => {
  beforeEach(() => localStorage.clear());

  it('keeps one id per device from before the first send, until it is done', () => {
    expect(readMark()).toBeNull();
    const m = pendingMark(() => 'AbCdEfGhIjKlMnOpQrStUv');
    expect(m).toEqual({ v: 1, importId: 'AbCdEfGhIjKlMnOpQrStUv', done: false, added: 0 });
    expect(pendingMark(() => 'ZyXwVuTsRqPoNmLkJiHgFe')).toEqual(m); // a resend reuses it
    markDone(m, 40);
    expect(readMark()).toEqual({ ...m, done: true, added: 40 });
  });

  it('new ids are 22 URL-safe characters', () => {
    expect(newImportId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newImportId()).not.toBe(newImportId());
  });
});

describe('importPreview', () => {
  const d = importDefaults(device) as ImportDefaults;
  const req = (over: Partial<ImportDefaults['fields']> = {}) => importRequest({ ...d.fields, ...over }, d, 'AbCdEfGhIjKlMnOpQrStUv', 420, '2026-10-08') as ImportRequest;

  it('says what will be created: runs, best, average, streaks, last day', () => {
    expect(importPreview(req())).toBe('Will add 40 runs: best 0:41.0, average 1:18.5, streak 3 days, longest streak 5 days, last played 2026-10-07.');
  });
  it('speaks in the singular, and with thousands', () => {
    expect(importPreview(req({ solved: '1', streak: '1', longest: '1' }))).toBe('Will add 1 run: best 0:41.0, average 0:41.0, streak 1 day, longest streak 1 day, last played 2026-10-07.');
    expect(importPreview(req({ solved: '1500' }))).toContain('Will add 1,500 runs');
  });
  it('never truncates a typed average: hundredths and thousandths stay in the line', () => {
    expect(importPreview(req({ average: '1:18.45' }))).toContain('average 1:18.45,');
    expect(importPreview(req({ average: '1:18.456' }))).toContain('average 1:18.456,');
    expect(importPreview(req({ average: '1:18.05' }))).toContain('average 1:18.05,');
    expect(importPreview(req({ average: '1:18.5' }))).toContain('average 1:18.5,');
    expect(importPreview(req({ average: '1:18' }))).toContain('average 1:18.0,');
  });
  it('exactMs keeps the tenths form for whole tenths and adds only the digits that exist', () => {
    expect([0, 100, 78_500, 78_450, 78_456, 78_405, 78_401, 3_600_000].map(exactMs)).toEqual(['0:00.0', '0:00.1', '1:18.5', '1:18.45', '1:18.456', '1:18.405', '1:18.401', '60:00.0']);
  });
});
