import { ITEMS, itemOf, type ItemDef, type ItemId } from '../core/catalogue';
import { parseLook, type Decor, type Look } from '../store/look';

/** The results tag's unlock line: the best of what is new, and how many more. */
export interface UnlockLine {
  best: ItemDef;
  more: number;
}

const ORDER: ReadonlyMap<string, number> = new Map(ITEMS.map((i, k) => [i.id, k]));

/** The highest prestige leads ("Unlocked: Bubble lights · Try it"), the first in catalogue order on a tie; null for nothing new. */
export function unlockLine(ids: readonly ItemId[]): UnlockLine | null {
  const defs = ids.map((id) => itemOf(id)).filter((d): d is ItemDef => d !== undefined);
  if (defs.length === 0) return null;
  const rank = (d: ItemDef): number => ORDER.get(d.id) ?? Infinity;
  const best = defs.reduce((a, b) => (b.prestige > a.prestige || (b.prestige === a.prestige && rank(b) < rank(a)) ? b : a));
  return { best, more: defs.length - 1 };
}

/**
 * What "Try it" does to the look, as the drawer's pick would: a decoration is switched on, any other slot takes the
 * item's value. Null for an item the look has no place for yet (it keeps only what parseLook accepts), and for a sound.
 */
export function tryPatch(look: Look, item: ItemDef): Partial<Look> | null {
  if (item.slot === 'decor') {
    if (!(item.value in look.decor)) return null;
    return { decor: { ...look.decor, [item.value as keyof Decor]: true } };
  }
  const slot = item.slot as keyof Look;
  if (slot === 'v' || !(slot in look)) return null;
  const patched = parseLook({ ...look, [slot]: item.value });
  return patched[slot] === item.value ? ({ [slot]: item.value } as Partial<Look>) : null;
}

/**
 * When unlock news reaches the screen (season two, Parts C2+C3). Never during a run: a change UnlockState reports then
 * (the look it re-applies, the pile, the dot) is held until the run ends, at the tag or a new tree (ruling R9). What is
 * new goes on the results tag of the run just won, once the session is known (until /api/me answers, the player's key is
 * a guess), and is then known.
 */
export class UnlockNews {
  private held = false;
  /** What this tag has announced. */
  private told: ItemId[] = [];

  constructor(
    private readonly unlocks: { fresh(): ItemId[]; markKnown(ids: readonly ItemId[]): void },
    private readonly h: {
      /** A run is in progress (the first move to the win or a new tree). */
      inRun(): boolean;
      /** The results tag is up. */
      tagUp(): boolean;
      /** The session has answered: who is playing is known. */
      known(): boolean;
      /** Shows what the player owns now: the look, the pile and the dot. */
      apply(): void;
      ribbon(line: UnlockLine | null): void;
    },
  ) {}

  /** UnlockState's onChange: shown now, or held while a run is in progress. */
  changed(): void {
    if (this.h.inRun()) {
      this.held = true;
      return;
    }
    this.held = false;
    this.h.apply();
    this.tell();
  }

  /** The run has ended (a new tree, or the win): what was held shows. */
  settle(): void {
    if (this.held && !this.h.inRun()) {
      this.held = false;
      this.h.apply();
    }
  }

  /** A results tag has just come up: nothing on it yet, then what was held and what is new. */
  tagShown(): void {
    this.told = [];
    this.h.ribbon(null);
    this.settle();
    this.tell();
  }

  /** What is new goes on the tag that is up, and is then known. */
  tell(): void {
    if (!this.h.tagUp() || !this.h.known() || this.h.inRun()) return;
    const fresh = this.unlocks.fresh();
    if (fresh.length === 0) return;
    this.told = [...this.told, ...fresh];
    this.unlocks.markKnown(fresh);
    this.h.ribbon(unlockLine(this.told));
  }
}
