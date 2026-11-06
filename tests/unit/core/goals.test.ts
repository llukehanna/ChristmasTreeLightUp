import { describe, expect, it } from 'vitest';
import { ITEMS, STARTER, itemOf } from '../../../src/core/catalogue';
import { FEAT } from '../../../src/core/facts';
import { GOALS, PILE_STEP, evaluate, pileOf, type History, type RunRecord } from '../../../src/core/goals';
import { FIREPLACE_ID } from '../../../src/radio/ids';

const DAY_MS = 86_400_000;
/** The day number of a UTC date. */
const day = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d) / DAY_MS;
/** An ordinary Daily day (not in December). */
const D = day(2026, 11, 10);

let clock = 0;
/** A fresh, clean, random-tree run, started after every run made before it. */
const run = (over: Partial<RunRecord> = {}): RunRecord => {
  clock += 1000;
  return {
    started: clock,
    finished: clock + 100_000,
    ms: 100_000,
    reason: null,
    imported: false,
    daily: null,
    past: false,
    turns: 53,
    minTurns: 50,
    feats: 0,
    pauses: 0,
    tz: null,
    station: null,
    world: null,
    ...over,
  };
};

const history = (runs: RunRecord[], over: Partial<History> = {}): History => ({ treesLit: runs.length, runs, topTenDays: 0, ...over });
const goals = (runs: RunRecord[], over: Partial<History> = {}) => evaluate(history(runs, over)).goals;
/** Epoch ms of a UTC wall-clock time. */
const utc = (y: number, m: number, d: number, h = 12, min = 0): number => Date.UTC(y, m - 1, d, h, min);

describe('evaluate', () => {
  it('milestones from treesLit alone (the guest case)', () => {
    const e = evaluate({ treesLit: 12, runs: [], topTenDays: 0 });
    expect(e.earned).toEqual(expect.arrayContaining(['decor:tinsel', 'scene:midnight', 'scene:sash', 'path:fairy', 'sound:rain']));
    expect(e.earned).not.toContain('path:neon');
    expect(e.goals.m25).toEqual({ have: 12, need: 25, done: false });
    expect(e.goals.m10).toEqual({ have: 10, need: 10, done: true });
    expect(e.goals.s120).toEqual({ have: 0, need: 120_000, done: false });
  });

  it('earned items follow ITEMS order', () => {
    const e = evaluate({ treesLit: 1000, runs: [run({ ms: 30_000, turns: 50 })], topTenDays: 1 });
    const order = ITEMS.map((i) => i.id);
    expect(e.earned).toEqual([...e.earned].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(e.earned).toContain('tree:tinsel');
    expect(e.earned).toContain('tag:goldfoil');
  });

  it('speed takes the best fresh time, under each tier', () => {
    const g = goals([run({ ms: 70_000 }), run({ ms: 59_999 }), run({ ms: 80_000 })]);
    expect(g.s60).toEqual({ have: 59_999, need: 60_000, done: true });
    expect(g.s45).toEqual({ have: 59_999, need: 45_000, done: false });
    expect(goals([run({ ms: 60_000 })]).s60.done).toBe(false);
  });

  it('speed counts a Daily first attempt but not a repeat of the same day', () => {
    const runs = [run({ daily: D, reason: 'daily', ms: 70_000, started: 1 }), run({ daily: D, reason: 'daily', ms: 50_000, started: 2 })];
    expect(evaluate({ treesLit: 2, runs, topTenDays: 0 }).goals.s60.done).toBe(false);
    expect(evaluate({ treesLit: 2, runs, topTenDays: 0 }).goals.s90.done).toBe(true);
  });

  it('a Daily day forfeited unfinished makes every later run that day a repeat', () => {
    const runs = [run({ daily: D, reason: null, finished: null, ms: null, started: 1 }), run({ daily: D, reason: 'daily', ms: 50_000, started: 2 })];
    expect(goals(runs).s60.have).toBe(0);
    // A past-day run of the same tree is the same day: the earliest row of either kind decides.
    const past = [run({ daily: D, reason: 'daily', ms: 70_000, started: 1 }), run({ daily: D, past: true, reason: 'past', ms: 50_000, started: 2 })];
    expect(goals(past).s60.done).toBe(false);
    // Rows arrive in any order: `started` decides which is first.
    const shuffled = [run({ daily: D, reason: 'daily', ms: 50_000, started: 5 }), run({ daily: D, reason: 'daily', ms: 70_000, started: 4 })];
    expect(goals(shuffled).s60.done).toBe(false);
  });

  it('Ao5 drops best and worst of five consecutive fresh runs', () => {
    const g = goals([40, 50, 55, 58, 200].map((s) => run({ ms: s * 1000 })));
    expect(g.a60).toEqual({ have: 54_333, need: 60_000, done: true });
    expect(g.a45.done).toBe(false);
    expect(goals([40, 50, 55, 58].map((s) => run({ ms: s * 1000 }))).a60).toEqual({ have: 0, need: 60_000, done: false });
    // The best window of five wins.
    const best = goals([90, 90, 44, 44, 44, 44, 44, 90].map((s) => run({ ms: s * 1000 })));
    expect(best.a45).toEqual({ have: 44_000, need: 45_000, done: true });
  });

  it('a Daily repeat is skipped in a sequence; an unfinished tree breaks it', () => {
    // Two clean, an unclean repeat of the first's Daily, one clean: three in a row, as if the repeat never happened.
    const repeat = [run({ daily: D, reason: 'daily' }), run(), run({ daily: D, reason: 'daily', turns: 90 }), run()];
    expect(goals(repeat).clean3.done).toBe(true);
    expect(goals([run(), run(), run({ turns: 90 }), run()]).clean3.done).toBe(false);
    const broken = [run(), run(), run({ finished: null, ms: null, turns: null, minTurns: null, feats: null, pauses: null }), run(), run()];
    expect(goals(broken).clean3).toEqual({ have: 2, need: 3, done: false });
    // The same for Ao5: four fast runs either side of an unfinished one never make five in a row.
    const ao5 = [run({ ms: 40_000 }), run({ ms: 40_000 }), run({ finished: null, ms: null }), run({ ms: 40_000 }), run({ ms: 40_000 }), run({ ms: 40_000 })];
    expect(goals(ao5).a45.done).toBe(false);
    // An unclean run resets the clean streak; a run without facts is not clean.
    expect(goals([run(), run(), run({ turns: 56 }), run(), run()]).clean3.have).toBe(2);
    expect(goals([run(), run(), run({ turns: null, minTurns: null, feats: null }), run(), run()]).clean3.done).toBe(false);
    // Imported rows are not played in the sequence: they neither count nor break it.
    expect(goals([run(), run({ imported: true, finished: null }), run(), run()]).clean3.done).toBe(true);
  });

  it("a run judged 'paused' breaks the clean streak and never counts for speed", () => {
    const g = goals([run(), run(), run({ reason: 'paused', ms: 30_000 }), run(), run()]);
    expect(g.clean3.done).toBe(false);
    expect(g.s60.done).toBe(false);
    expect(g.s120.have).toBe(100_000);
    expect(goals([run({ reason: 'too_fast', ms: 30_000 }), run({ reason: 'clock', ms: 30_000 })]).s120.have).toBe(0);
  });

  it('imported runs count as trees lit and nothing else', () => {
    const imp = run({ imported: true, ms: 30_000, turns: 50, feats: FEAT.grand, tz: 0, finished: utc(2025, 12, 25), station: FIREPLACE_ID });
    const e = evaluate({ treesLit: 1, runs: [imp], topTenDays: 0 });
    expect(e.earned).toEqual(['decor:tinsel']);
    expect(e.goals.s120.have).toBe(0);
    expect(e.goals.perfect.done).toBe(false);
    expect(e.goals.grand.done).toBe(false);
    expect(e.goals.xmasDay.done).toBe(false);
    expect(e.goals.fireplace100.have).toBe(0);
  });

  it('clean is within 5 turns of the minimum, perfect is at most the minimum', () => {
    expect(goals([run({ turns: 55, minTurns: 50 })]).clean.done).toBe(true);
    expect(goals([run({ turns: 56, minTurns: 50 })]).clean.done).toBe(false);
    expect(goals([run({ turns: 50, minTurns: 50 })]).perfect.done).toBe(true);
    expect(goals([run({ turns: 51, minTurns: 50 })]).perfect.done).toBe(false);
    // A run from before the facts: counts for speed, never clean.
    const old = goals([run({ turns: null, minTurns: null, feats: null, ms: 50_000 })]);
    expect(old.clean.done).toBe(false);
    expect(old.s60.done).toBe(true);
  });

  it('feats come from fresh runs only', () => {
    expect(goals([run({ reason: 'too_fast', feats: FEAT.grand })]).grand.done).toBe(false);
    const all = FEAT.grand | FEAT.starLast | FEAT.neverDark | FEAT.steady | FEAT.comeback;
    const g = goals([run({ feats: all })]);
    expect([g.grand.done, g.starLast.done, g.neverDark.done, g.steady.done, g.comeback.done]).toEqual([true, true, true, true, true]);
    const daily = [run({ daily: D, reason: 'daily' }), run({ daily: D, reason: 'daily', feats: FEAT.starLast })];
    expect(goals(daily).starLast.done).toBe(false);
  });

  it('noPause needs ms < 60000 and zero pauses', () => {
    expect(goals([run({ ms: 59_000, pauses: 0 })]).noPause.done).toBe(true);
    expect(goals([run({ ms: 60_000, pauses: 0 })]).noPause.done).toBe(false);
    expect(goals([run({ ms: 59_000, pauses: 1 })]).noPause.done).toBe(false);
    expect(goals([run({ ms: 59_000, pauses: null })]).noPause.done).toBe(false);
    expect(goals([run({ ms: 59_000, pauses: 0, reason: 'clock' })]).noPause.done).toBe(false);
  });

  it('holidays read the local time at the finish', () => {
    // Dec 25 23:30 local at tz -60 (an hour ahead of UTC) is Dec 25 22:30 UTC.
    const xmas = goals([run({ finished: utc(2026, 12, 25, 22, 30), tz: -60 })]);
    expect(xmas.xmasDay.done).toBe(true);
    // An hour later at tz -60 is 00:30 on Dec 26; a finish with no zone is skipped.
    expect(goals([run({ finished: utc(2026, 12, 25, 23, 30), tz: -60 })]).xmasDay.done).toBe(false);
    expect(goals([run({ finished: utc(2026, 12, 25, 12), tz: null })]).xmasDay.done).toBe(false);
    expect(goals([run({ finished: utc(2026, 12, 24, 23), tz: 0 })]).xmasEve.done).toBe(true);
    // New Year's midnight: 00:00 to 00:59 local on Jan 1. 05:30 UTC at tz 300 (UTC−5) is 00:30.
    expect(goals([run({ finished: utc(2027, 1, 1, 5, 30), tz: 300 })]).newYear.done).toBe(true);
    expect(goals([run({ finished: utc(2027, 1, 1, 6, 0), tz: 300 })]).newYear.done).toBe(false);
    // 3 a.m. local; any finished tree counts, ranked or not.
    expect(goals([run({ finished: utc(2026, 3, 1, 2, 15), tz: -60, reason: 'paused' })]).threeAm.done).toBe(true);
    expect(goals([run({ finished: utc(2026, 3, 1, 3, 15), tz: -60 })]).threeAm.done).toBe(false);
    // An unfinished tree is no tree.
    expect(goals([run({ finished: null, ms: null, started: utc(2026, 12, 25), tz: 0 })]).xmasDay.done).toBe(false);
  });

  it('Daily streak counts consecutive live days, never a past day', () => {
    const live = (d: number, over: Partial<RunRecord> = {}): RunRecord => run({ daily: d, reason: 'daily', ...over });
    const g = goals([live(D), live(D + 1), live(D + 2), live(D + 4), live(D + 5)]);
    expect(g.streak3).toEqual({ have: 3, need: 3, done: true });
    expect(g.streak7).toEqual({ have: 3, need: 7, done: false });
    const past = goals([live(D), live(D + 1, { past: true, reason: 'past' }), live(D + 2)]);
    expect(past.streak3.have).toBe(1);
    // A day counts with any finished live run, even a repeat or an unranked one, but not an unfinished one.
    expect(goals([live(D), live(D + 1, { finished: null, ms: null }), live(D + 1, { reason: 'paused' }), live(D + 2)]).streak3.done).toBe(true);
    expect(goals([live(D), live(D + 1, { finished: null, ms: null }), live(D + 2)]).streak3.done).toBe(false);
  });

  it('Advent door 6 opens from a past-day run of Dec 6, any year; all 24 give the gold star', () => {
    const g = goals([run({ daily: day(2025, 12, 6), past: true, reason: 'past' })]);
    expect(g.door6.done).toBe(true);
    expect(g.door5.done).toBe(false);
    expect(g.advent24).toEqual({ have: 1, need: 24, done: false });
    expect(evaluate(history([run({ daily: day(2025, 12, 6), past: true, reason: 'past' })])).earned).toContain('tag:gingerbread');
    // An unfinished Daily row opens nothing; a random tree played on Dec 6 is no Daily.
    expect(goals([run({ daily: day(2026, 12, 6), reason: 'daily', finished: null, ms: null })]).door6.done).toBe(false);
    expect(goals([run({ finished: utc(2026, 12, 6), tz: 0 })]).door6.done).toBe(false);
    // Nov 6 is not door 6.
    expect(goals([run({ daily: day(2026, 11, 6), reason: 'daily' })]).door6.done).toBe(false);
    const doors = Array.from({ length: 24 }, (_, k) => run({ daily: day(k % 2 ? 2026 : 2027, 12, k + 1), reason: 'daily' }));
    const all = evaluate(history(doors));
    expect(all.goals.advent24).toEqual({ have: 24, need: 24, done: true });
    expect(all.earned).toContain('topper:goldstar');
    expect(all.earned).toContain('presents:goldfoil');
  });

  it('eggs and the Fireplace count need the reported context', () => {
    const g = goals([run({ world: 'secret' }), run({ world: 'home-alone', finished: null, ms: null })]);
    expect(g.eggSecret.done).toBe(true);
    expect(g.eggHomeAlone.done).toBe(false);
    expect(goals([run({ world: 'home-alone', reason: 'paused' })]).eggHomeAlone.done).toBe(true);
    const fire = (n: number, over: Partial<RunRecord> = {}): RunRecord[] => Array.from({ length: n }, () => run({ station: FIREPLACE_ID, ...over }));
    expect(goals(fire(99)).fireplace100).toEqual({ have: 99, need: 100, done: false });
    expect(goals([...fire(99), run({ station: 'rain' }), ...fire(3, { finished: null, ms: null })]).fireplace100.done).toBe(false);
    expect(goals(fire(120)).fireplace100).toEqual({ have: 100, need: 100, done: true });
  });

  it('top10 is done when topTenDays >= 1', () => {
    expect(goals([], { topTenDays: 0 }).top10).toEqual({ have: 0, need: 1, done: false });
    expect(goals([], { topTenDays: 3 }).top10).toEqual({ have: 1, need: 1, done: true });
    expect(evaluate({ treesLit: 0, runs: [], topTenDays: 1 }).earned).toEqual(['garland:champagne']);
  });
});

describe('pileOf', () => {
  it('pileOf: one present per 5 trees, at most what was placed', () => {
    expect(PILE_STEP).toBe(5);
    expect([pileOf(4, 6), pileOf(5, 6), pileOf(31, 6), pileOf(31, 5)]).toEqual([0, 1, 6, 5]);
  });
});

describe('the catalogue', () => {
  it('every item has a goal, and every goal unlocks at least one item', () => {
    const goalIds = new Set<string>(GOALS.map((g) => g.id));
    for (const item of ITEMS) expect(goalIds.has(item.goal), item.id).toBe(true);
    const used = new Set<string>(ITEMS.map((i) => i.goal));
    for (const g of GOALS) expect(used.has(g.id), g.id).toBe(true);
    expect(GOALS).toHaveLength(63);
  });

  it('ids are slot:value, unique, and never a starter', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    for (const i of ITEMS) {
      expect(i.id).toBe(`${i.slot}:${i.value}`);
      expect(STARTER[i.slot], i.id).not.toBe(i.value);
    }
  });

  it('skill items outrank calendar items, which outrank milestone items', () => {
    const kindOf = new Map<string, string>(GOALS.map((g) => [g.id, g.kind]));
    const band = (k: string): number => (k === 'milestone' ? 0 : ['speed', 'ao5', 'precision', 'feat'].includes(k) ? 2 : 1);
    for (const a of ITEMS) {
      for (const b of ITEMS) {
        if (band(kindOf.get(a.goal)!) > band(kindOf.get(b.goal)!)) expect(a.prestige, `${a.id} > ${b.id}`).toBeGreaterThan(b.prestige);
      }
    }
    const p = (id: string): number => itemOf(id)!.prestige;
    expect(p('tag:goldfoil')).toBeGreaterThan(p('topper:star'));
    expect(p('tree:tinsel')).toBeGreaterThan(p('decor:tinsel'));
    expect(p('topper:goldstar')).toBeGreaterThan(p('palette:classic'));
  });

  it('itemOf finds an item by id', () => {
    expect(itemOf('strand:bubble')).toMatchObject({ slot: 'strand', value: 'bubble', label: 'Bubble lights', goal: 'm100' });
    expect(itemOf('presents:game')).toMatchObject({ label: 'Festive presents', goal: 'm5' });
    expect(itemOf('scene:fireside')).toBeUndefined();
    expect(itemOf('nope')).toBeUndefined();
  });

  it('goal text', () => {
    const text = (id: string): string | undefined => GOALS.find((g) => g.id === id)?.text;
    expect([text('m25'), text('s60'), text('a60'), text('clean'), text('streak7'), text('top10'), text('xmasDay'), text('door6'), text('advent24')]).toEqual([
      'Light 25 trees',
      'A tree under 1:00',
      'Average of 5 under 1:00',
      'A tree within 5 turns of its minimum',
      'Play the Daily Tree 7 days in a row',
      'A top 10 on a Daily board',
      'A tree on Christmas Day',
      'Open Advent door 6',
      'Open all 24 Advent doors',
    ]);
    for (const g of GOALS) expect(g.text.length, g.id).toBeGreaterThan(0);
  });
});
