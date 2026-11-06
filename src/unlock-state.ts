import type { ProgressResponse } from './api/types';
import { ITEMS, type ItemId } from './core/catalogue';
import { evaluate, GOALS, type GoalId, type GoalState } from './core/goals';
import { loadUnlocks, playerKey, saveUnlocks, type UnlockRecord } from './store/unlocks';

const MILESTONES: ReadonlySet<GoalId> = new Set(GOALS.filter((g) => g.kind === 'milestone').map((g) => g.id));
const NEED: ReadonlyMap<GoalId, number> = new Map(GOALS.map((g) => [g.id, g.need]));

/** In catalogue order, without repeats. */
const ordered = (ids: Iterable<ItemId>): ItemId[] => {
  const set = new Set(ids);
  return ITEMS.filter((i) => set.has(i.id)).map((i) => i.id);
};

/**
 * What the player owns (season two, Parts C2+C3): the server's set (or this player's cached one, until it arrives) with
 * what this device's own trees earn. Guests earn milestones only, from this device (Decision 8). Kept per player on the
 * device (src/store/unlocks.ts), with what they have been told of. Never touches the saved look: the app shows
 * `effectiveLook` of it.
 */
export class UnlockState {
  /** null: no player to keep it under (a signed-in player without an id): this device's set alone, never saved. */
  private key: string | null = null;
  private deviceSolved = 0;
  private server: ProgressResponse | null = null;
  private rec: UnlockRecord = { earned: [], known: [], seen: [], synced: false, treesLit: 0 };
  private earned: ReadonlySet<ItemId> = new Set();

  constructor(private readonly h: { onChange(): void }) {}

  owns(id: ItemId): boolean {
    return this.earned.has(id);
  }

  /** How far along a goal is; null for what a guest's device can't tell (all but the milestones). */
  goal(id: GoalId): GoalState | null {
    if (MILESTONES.has(id)) {
      const need = NEED.get(id) as number;
      const have = this.treesLit();
      return { have: Math.min(have, need), need, done: have >= need };
    }
    return this.server?.goals[id] ?? null;
  }

  /** Trees lit: the larger of the server's (or the cached count) and this device's. */
  treesLit(): number {
    return Math.max(this.server?.treesLit ?? this.rec.treesLit, this.deviceSolved);
  }

  /**
   * Who is playing (the account's id, null for a guest, undefined for no key yet), and this device's trees lit. A new
   * player's record starts with what they have now, all known and seen: nothing is announced for it.
   */
  setPlayer(userId: number | null | undefined, deviceSolved: number): void {
    const key = userId === undefined ? null : playerKey(userId);
    const before = this.snapshot();
    if (key !== this.key) {
      this.key = key;
      this.server = null;
      const cached = key === null ? null : loadUnlocks(key);
      this.rec = cached ?? { earned: [], known: [], seen: [], synced: false, treesLit: 0 };
      this.deviceSolved = deviceSolved;
      this.earned = new Set([...this.rec.earned, ...this.deviceSet()]);
      if (!cached) this.seed();
    } else {
      this.deviceSolved = deviceSolved;
      this.earned = new Set([...(this.server?.earned ?? this.rec.earned), ...this.deviceSet()]);
    }
    this.settle(before);
  }

  /**
   * The account's progress, or null when the fetch failed (the cached set stays). The first set a record hears of is
   * seeded silently: on launch day, what a player already had is not news.
   */
  setServer(p: ProgressResponse | null): void {
    if (p === null || this.key === null || this.key === playerKey(null)) return;
    const before = this.snapshot();
    this.server = p;
    this.earned = new Set([...p.earned, ...this.deviceSet()]);
    if (!this.rec.synced) {
      this.rec.synced = true;
      this.seed();
    }
    this.settle(before);
  }

  /** Earned, and never announced. */
  fresh(): ItemId[] {
    const known = new Set(this.rec.known);
    return ordered(this.earned).filter((id) => !known.has(id));
  }

  markKnown(ids: readonly ItemId[]): void {
    this.rec.known = ordered([...this.rec.known, ...ids]);
    this.save();
  }

  /** Earned, and not seen in the wardrobe yet. */
  unseen(): ItemId[] {
    const seen = new Set(this.rec.seen);
    return ordered(this.earned).filter((id) => !seen.has(id));
  }

  markSeen(): void {
    this.rec.seen = ordered([...this.rec.seen, ...this.earned]);
    this.save();
  }

  private deviceSet(): ItemId[] {
    return evaluate({ treesLit: this.deviceSolved, runs: [], topTenDays: 0 }).earned;
  }

  /** Everything earned now is known and seen. */
  private seed(): void {
    this.rec.known = ordered([...this.rec.known, ...this.earned]);
    this.rec.seen = ordered([...this.rec.seen, ...this.earned]);
  }

  private snapshot(): string {
    return `${ordered(this.earned).join()}|${this.treesLit()}`;
  }

  /** Keeps the record, and tells the app when what it shows (the set, or the pile) has changed. */
  private settle(before: string): void {
    this.rec.earned = ordered(this.earned);
    this.rec.treesLit = this.treesLit();
    this.save();
    if (this.snapshot() !== before) this.h.onChange();
  }

  private save(): void {
    if (this.key !== null) saveUnlocks(this.key, this.rec);
  }
}
