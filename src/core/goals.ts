/**
 * The goals that earn the catalogue's items, and evaluate(), which reads a player's runs into what they have earned
 * (season two, Parts C2+C3). Pure and shared: the Worker runs it over the rows it verified, the client over a guest's
 * count. Which runs count for what is the plan's Decisions 1, 2 and 5–9.
 */
import { ITEMS, type ItemId } from './catalogue';
import { FEAT } from './facts';
import type { UnrankedReason } from './judge';
import { FIREPLACE_ID } from '../radio/ids';

export type GoalKind = 'milestone' | 'speed' | 'ao5' | 'precision' | 'feat' | 'calendar' | 'advent' | 'secret';

const goal = <I extends string>(id: I, kind: GoalKind, need: number, text: string) => ({ id, kind, need, text }) as const;
const door = <N extends number>(d: N) => goal(`door${d}` as `door${N}`, 'advent', 1, `Open Advent door ${d}`);

export const GOALS = [
  goal('m1', 'milestone', 1, 'Light your first tree'),
  goal('m5', 'milestone', 5, 'Light 5 trees'),
  goal('m10', 'milestone', 10, 'Light 10 trees'),
  goal('m25', 'milestone', 25, 'Light 25 trees'),
  goal('m50', 'milestone', 50, 'Light 50 trees'),
  goal('m100', 'milestone', 100, 'Light 100 trees'),
  goal('m250', 'milestone', 250, 'Light 250 trees'),
  goal('m500', 'milestone', 500, 'Light 500 trees'),
  goal('m1000', 'milestone', 1000, 'Light 1,000 trees'),
  goal('s120', 'speed', 120_000, 'A tree under 2:00'),
  goal('s90', 'speed', 90_000, 'A tree under 1:30'),
  goal('s60', 'speed', 60_000, 'A tree under 1:00'),
  goal('s45', 'speed', 45_000, 'A tree under 0:45'),
  goal('s40', 'speed', 40_000, 'A tree under 0:40'),
  goal('s35', 'speed', 35_000, 'A tree under 0:35'),
  goal('a60', 'ao5', 60_000, 'Average of 5 under 1:00'),
  goal('a45', 'ao5', 45_000, 'Average of 5 under 0:45'),
  goal('clean', 'precision', 1, 'A tree within 5 turns of its minimum'),
  goal('perfect', 'precision', 1, 'A tree in its minimum turns'),
  goal('clean3', 'precision', 3, '3 trees in a row within 5 turns of their minimum'),
  goal('grand', 'feat', 1, 'Light 40 tiles with your last turn'),
  goal('starLast', 'feat', 1, 'Light the star with your last turn'),
  goal('neverDark', 'feat', 1, 'A tree where no light ever goes out'),
  goal('steady', 'feat', 1, 'A tree without turning a tile already in place'),
  goal('noPause', 'feat', 1, 'A tree under 1:00 without a pause'),
  goal('comeback', 'feat', 1, 'Win after falling from over 80% lit to under 30%'),
  goal('streak3', 'calendar', 3, 'Play the Daily Tree 3 days in a row'),
  goal('streak7', 'calendar', 7, 'Play the Daily Tree 7 days in a row'),
  goal('streak14', 'calendar', 14, 'Play the Daily Tree 14 days in a row'),
  goal('streak30', 'calendar', 30, 'Play the Daily Tree 30 days in a row'),
  goal('top10', 'calendar', 1, 'A top 10 on a Daily board'),
  goal('xmasEve', 'calendar', 1, 'A tree on Christmas Eve'),
  goal('xmasDay', 'calendar', 1, 'A tree on Christmas Day'),
  goal('newYear', 'calendar', 1, "A tree in the first hour of New Year's Day"),
  door(1), door(2), door(3), door(4), door(5), door(6), door(7), door(8), door(9), door(10), door(11), door(12),
  door(13), door(14), door(15), door(16), door(17), door(18), door(19), door(20), door(21), door(22), door(23), door(24),
  goal('advent24', 'advent', 24, 'Open all 24 Advent doors'),
  goal('eggSecret', 'secret', 1, 'A tree in secret mode'),
  goal('eggHomeAlone', 'secret', 1, 'A tree in the Home Alone world'),
  goal('threeAm', 'secret', 1, 'A tree at 3 a.m.'),
  goal('fireplace100', 'secret', 100, 'Light 100 trees by the Fireplace'),
] as const satisfies readonly { id: string; kind: GoalKind; need: number; text: string }[];

export type GoalId = (typeof GOALS)[number]['id'];

export interface GoalDef {
  id: GoalId;
  kind: GoalKind;
  /** A count, or for `speed` and `ao5` the time in ms to beat. */
  need: number;
  text: string;
}

/** One of the player's game rows, as the Worker reads it. */
export interface RunRecord {
  started: number;
  /** null: never finished. */
  finished: number | null;
  ms: number | null;
  reason: UnrankedReason | null;
  /** From the history import: counts as a tree lit and nothing else. */
  imported: boolean;
  /** The Daily Tree's day number (days since 1970-01-01 UTC), or null for a random tree. */
  daily: number | null;
  /** A past day's tree, played after its day. */
  past: boolean;
  /** Facts from the replay (null on runs from before them). */
  turns: number | null;
  minTurns: number | null;
  feats: number | null;
  pauses: number | null;
  /** Reported context (null on runs from before it): the zone at the finish (UTC minus local, in minutes), the station, the world. */
  tz: number | null;
  station: string | null;
  world: 'secret' | 'home-alone' | null;
}

export interface History {
  /** Trees lit, every source (Decision 1). */
  treesLit: number;
  runs: readonly RunRecord[];
  /** Daily days on whose frozen board the player placed in the top 10. */
  topTenDays: number;
}

export interface GoalState {
  /** A count capped at `need`, or for `speed` and `ao5` the best time in ms (0: none yet). */
  have: number;
  need: number;
  done: boolean;
}

/** Turns over a tree's minimum that still make a clean run (Decision 5). */
const CLEAN_TURNS = 5;
const AO5 = 5;
const NO_PAUSE_MS = 60_000;
const DAY_MS = 86_400_000;
const ADVENT_DOORS = 24;

/** The mean of the middle three of five times, rounded down (so it never reads under the true mean). */
const ao5Of = (times: readonly number[]): number => {
  const t = [...times].sort((a, b) => a - b);
  return Math.floor((t[1] + t[2] + t[3]) / 3);
};

/** The longest run of consecutive day numbers. */
const longestRun = (days: ReadonlySet<number>): number => {
  let longest = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue;
    let n = 1;
    while (days.has(d + n)) n++;
    longest = Math.max(longest, n);
  }
  return longest;
};

/** What a player has earned from their history, and how far along every goal is. */
export function evaluate(h: History): { earned: ItemId[]; goals: Record<GoalId, GoalState> } {
  const runs = h.runs.filter((r) => !r.imported).sort((a, b) => a.started - b.started);

  // Each Daily day's earliest-started row, finished or not, is its one fresh attempt, unless it is a past day's tree
  // (public replays: Decision 11): every later row that day, live or past, is a repeat.
  const firstOfDay = new Map<number, RunRecord>();
  for (const r of runs) if (r.daily !== null && !firstOfDay.has(r.daily)) firstOfDay.set(r.daily, r);
  const isRepeat = (r: RunRecord): boolean => r.past || (r.daily !== null && firstOfDay.get(r.daily) !== r);
  const isFresh = (r: RunRecord): boolean =>
    r.finished !== null && r.ms !== null && (r.reason === null || r.reason === 'daily' || r.reason === 'past') && !isRepeat(r);

  let best = 0;
  let bestAo5 = 0;
  const last5: number[] = [];
  let clean = false;
  let perfect = false;
  let cleanRun = 0;
  let cleanBest = 0;
  let feats = 0;
  let noPause = false;
  let xmasEve = false;
  let xmasDay = false;
  let newYear = false;
  let threeAm = false;
  let eggSecret = false;
  let eggHomeAlone = false;
  let fireplace = 0;
  const liveDays = new Set<number>();
  const doors = new Set<number>();

  for (const r of runs) {
    // The sequence (Decision 2): a fresh run counts, a Daily repeat is skipped, anything else breaks it.
    if (isFresh(r)) {
      const ms = r.ms as number;
      if (best === 0 || ms < best) best = ms;
      last5.push(ms);
      if (last5.length > AO5) last5.shift();
      if (last5.length === AO5) {
        const avg = ao5Of(last5);
        if (bestAo5 === 0 || avg < bestAo5) bestAo5 = avg;
      }
      const facts = r.turns !== null && r.minTurns !== null;
      const isClean = facts && (r.turns as number) <= (r.minTurns as number) + CLEAN_TURNS;
      if (isClean) clean = true;
      if (facts && (r.turns as number) <= (r.minTurns as number)) perfect = true;
      cleanRun = isClean ? cleanRun + 1 : 0;
      cleanBest = Math.max(cleanBest, cleanRun);
      feats |= r.feats ?? 0;
      if (ms < NO_PAUSE_MS && r.pauses === 0) noPause = true;
    } else if (!isRepeat(r)) {
      last5.length = 0;
      cleanRun = 0;
    }

    // The calendar and the secrets: any finished tree, fresh or not (Decision 7).
    if (r.finished === null) continue;
    if (r.daily !== null) {
      if (!r.past) liveDays.add(r.daily);
      const day = new Date(r.daily * DAY_MS);
      if (day.getUTCMonth() === 11 && day.getUTCDate() <= ADVENT_DOORS) doors.add(day.getUTCDate());
    }
    if (r.tz !== null) {
      const local = new Date(r.finished - r.tz * 60_000);
      const [month, date, hour] = [local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours()];
      if (month === 12 && date === 24) xmasEve = true;
      if (month === 12 && date === 25) xmasDay = true;
      if (month === 1 && date === 1 && hour === 0) newYear = true;
      if (hour === 3) threeAm = true;
    }
    if (r.world === 'secret') eggSecret = true;
    if (r.world === 'home-alone') eggHomeAlone = true;
    if (r.station === FIREPLACE_ID) fireplace++;
  }

  const streak = longestRun(liveDays);
  const counts: Partial<Record<GoalId, number>> = {
    clean: +clean,
    perfect: +perfect,
    clean3: cleanBest,
    grand: +((feats & FEAT.grand) !== 0),
    starLast: +((feats & FEAT.starLast) !== 0),
    neverDark: +((feats & FEAT.neverDark) !== 0),
    steady: +((feats & FEAT.steady) !== 0),
    comeback: +((feats & FEAT.comeback) !== 0),
    noPause: +noPause,
    streak3: streak,
    streak7: streak,
    streak14: streak,
    streak30: streak,
    top10: h.topTenDays,
    xmasEve: +xmasEve,
    xmasDay: +xmasDay,
    newYear: +newYear,
    advent24: doors.size,
    eggSecret: +eggSecret,
    eggHomeAlone: +eggHomeAlone,
    threeAm: +threeAm,
    fireplace100: fireplace,
  };
  for (const d of doors) counts[`door${d}` as GoalId] = 1;

  const goals = {} as Record<GoalId, GoalState>;
  for (const g of GOALS) {
    if (g.kind === 'speed' || g.kind === 'ao5') {
      const have = g.kind === 'speed' ? best : bestAo5;
      goals[g.id] = { have, need: g.need, done: have > 0 && have < g.need };
    } else {
      const have = g.kind === 'milestone' ? h.treesLit : (counts[g.id] ?? 0);
      goals[g.id] = { have: Math.min(have, g.need), need: g.need, done: have >= g.need };
    }
  }
  return { earned: ITEMS.filter((i) => goals[i.goal].done).map((i) => i.id), goals };
}

/** Trees lit per present in the pile (Decision 9). */
export const PILE_STEP = 5;

/** Presents shown under the tree: one per PILE_STEP trees lit, at most the `placed` gifts. */
export const pileOf = (treesLit: number, placed: number): number => Math.min(placed, Math.floor(treesLit / PILE_STEP));
