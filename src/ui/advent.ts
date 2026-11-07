/**
 * The Advent calendar's page (season two, Part C3): 24 doors in the account sheet's glass (src/ui/sheet.ts), opened from
 * the settings menu. An open door shows the item it gave; today's door starts the live Daily, and a closed past day's
 * starts that day's tree (unranked, "a past day's tree"), through the same confirm as the menu's Daily row.
 */
import { ADVENT_DOORS, doorDay, doorItem, doorState, seasonYear, type DoorState } from '../core/advent';
import type { ItemDef, ItemId } from '../core/catalogue';
import { GARLAND_SETS } from '../render/garland-sets';
import { PALETTES } from '../render/palettes';
import { localDay } from '../store/stats';
import type { GarlandSet, PresentSet, TagStyle, TopperKind } from '../store/look';
import { garlandArt, PRESENT_ART, TAG_ART, TOPPER_ART } from './decorate-art';
import { esc } from './format';
import { I } from './icons';
import { Confirm, CONFIRM_TEXT, NEW_TREE_CONFIRM_MS } from './menu';
import type { Sheet, SheetView } from './sheet';

export interface AdventHooks {
  /** The account sheet the page shows in: its scrim, its focus handling, and the pause it puts on a game in progress. */
  sheet: Sheet;
  owns(id: ItemId): boolean;
  /** Signed out: a guest earns no doors until their runs are claimed. */
  guest(): boolean;
  /** A run is in progress: a door's first press only arms its confirm (the menu's needsConfirm). */
  needsConfirm(): boolean;
  /** The tree in play is today's live Daily: today's door just closes the page. */
  playingDaily(): boolean;
  /** Today's door: start today's live Daily, as the menu's Daily row does. */
  onToday(): void;
  /** A closed past day's door: start that day's tree (YYYY-MM-DD). */
  onDay(day: string): void;
}

const LABEL = 'Advent calendar';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Dec 8" for '2026-12-08'. */
const short = (day: string): string => {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/** What a closed door says under its number. */
const STATE_TEXT: Readonly<Record<Exclude<DoorState, 'open'>, string>> = { today: 'Today', 'catch-up': 'Catch up', waiting: 'Opens', future: '' };

/** An open door's swatch: the drawer's art for its item, its SVG ids made the door's own (a drawer copy may be hidden). */
function artOf(item: ItemDef, d: number): string {
  const v = item.value;
  const art =
    item.slot === 'palette' ? `<span class="deco-pal">${'<b></b>'.repeat(6)}</span>`
    : item.slot === 'garland' ? garlandArt()
    : item.slot === 'tag' ? TAG_ART[v as TagStyle]
    : item.slot === 'presents' ? PRESENT_ART[v as PresentSet]
    : item.slot === 'topper' ? TOPPER_ART[v as TopperKind]
    : '';
  return (art ?? '').replace(/\bdk\d+-/g, `adv${d}-`);
}

/** The bulbs of an open door's palette or garland swatch, in its set's colours (the drawer paints its own the same way). */
function paint(door: HTMLElement, item: ItemDef): void {
  if (item.slot === 'palette') {
    const colours = PALETTES[item.value as keyof typeof PALETTES];
    door.querySelectorAll<HTMLElement>('.deco-pal b').forEach((b, k) => b.style.setProperty('--c', colours[k % colours.length]));
  } else if (item.slot === 'garland') {
    const colours = GARLAND_SETS[item.value as Exclude<GarlandSet, 'game'>];
    door.querySelectorAll<SVGElement>('.deco-garl-g').forEach((b, k) => b.style.setProperty('--c', colours[k % colours.length]));
  }
}

export class AdventSheet {
  /** The doors' arm-then-confirm, keyed by door: the menu's rule and window. */
  private readonly confirm: Confirm<number>;
  private readonly view: SheetView;

  constructor(private readonly h: AdventHooks) {
    this.confirm = new Confirm(() => h.needsConfirm());
    this.view = { label: LABEL, card: false, render: (inner) => this.render(inner) };
  }

  get isOpen(): boolean {
    return this.h.sheet.isOpen && this.h.sheet.current === this.view;
  }

  open(from?: HTMLElement | null): void {
    this.confirm.reset();
    this.h.sheet.open(this.view, from);
  }

  close(): void {
    if (this.isOpen) this.h.sheet.close();
  }

  /** Repaints the page if it is on screen (a door opened, a confirm ran out). */
  refresh(): void {
    if (this.isOpen) this.h.sheet.update(this.view);
  }

  private render(inner: HTMLElement): void {
    const today = localDay(new Date());
    const now = Date.now();
    const armed = this.confirm.current;
    const doors = Array.from({ length: ADVENT_DOORS }, (_, i) => {
      const d = i + 1;
      const item = doorItem(d);
      return { d, item, ...doorState(d, today, now, this.h.owns(item.id)) };
    });
    const opened = doors.filter((x) => x.state === 'open').length;
    const notes = [
      today.slice(5, 7) === '11' ? 'Doors open December 1' : null,
      this.h.guest() ? 'Sign in to open doors · your trees still count once you do' : null,
    ].filter((n): n is string => n !== null);
    const cells = doors.map(({ d, item, state, opensOn }) => {
      const id = `adv-door-${d}`;
      if (state === 'open') {
        return `<li><div class="adv-door" id="${id}" data-state="open"><span class="adv-n">${d}</span><span class="deco-sw-art adv-art">${artOf(item, d)}</span><span class="adv-l">${esc(item.label)}</span></div></li>`;
      }
      const isArmed = armed === d && (state === 'today' || state === 'catch-up');
      const text = isArmed ? 'Tap again' : state === 'waiting' ? `Opens ${short(opensOn as string)}` : STATE_TEXT[state];
      // The date stays on one line when a narrow door wraps "Opens" above it.
      const shown = text.replace(/ (\d+)$/, '\u00a0$1');
      const name = `${short(doorDay(d, today))}${isArmed ? ` · ${CONFIRM_TEXT}` : text ? ` · ${text}` : ''}`;
      const playable = state === 'today' || state === 'catch-up';
      return `<li><button type="button" class="adv-door${isArmed ? ' armed' : ''}" id="${id}" data-state="${state}" data-door="${d}" aria-label="${name}"${playable ? '' : ' disabled'}><span class="adv-n">${d}</span>${text ? `<span class="adv-s">${shown}</span>` : ''}</button></li>`;
    });
    inner.innerHTML = `<header class="acct-head">
        <div class="acct-emb">${I.star}</div>
        <div class="acct-titles"><h2 class="acct-title">${LABEL}</h2><p class="acct-sub">December ${seasonYear(today)} · ${opened}/${ADVENT_DOORS} open</p></div>
      </header>
      <div class="acct-body adv-body">${notes.map((n) => `<p class="acct-note adv-note">${n}</p>`).join('')}<ol class="adv-grid" aria-label="Doors">${cells.join('')}</ol></div>`;
    for (const { d, item, state } of doors) if (state === 'open') paint(inner.querySelector<HTMLElement>(`#adv-door-${d}`)!, item);
    inner.querySelector('.adv-grid')!.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button.adv-door') : null;
      if (b && !b.disabled) this.pick(Number(b.dataset.door));
    });
  }

  private pick(d: number): void {
    const today = localDay(new Date());
    const { state } = doorState(d, today, Date.now(), this.h.owns(doorItem(d).id));
    if (state !== 'today' && state !== 'catch-up') return;
    // On today's live Daily there is nothing to start over to: the door just closes the page (the menu's row does too).
    if (state === 'today' && this.h.playingDaily()) {
      this.close();
      return;
    }
    if (this.confirm.press(d) === 'armed') {
      this.refresh();
      window.setTimeout(() => this.refresh(), NEW_TREE_CONFIRM_MS + 50);
      return;
    }
    this.close();
    if (state === 'today') this.h.onToday();
    else this.h.onDay(doorDay(d, today));
  }
}
