/**
 * The Decorate drawer (spec: Part B, from the lab's menus-decorate): one place to dress the tree, with painted swatches,
 * each pick applied live and saved. On desktop the stage glides into a framed window on the left so the drawer never
 * covers the tree, and the board stays playable there; on phones the stage rises above a bottom sheet.
 *
 * It is also the wardrobe (season two, Parts C2+C3): a swatch the player hasn't earned is locked and says its goal, one
 * earned since they last looked wears a New pip, and three saved looks sit under the header.
 */
import { itemOf, type ItemDef, type ItemId } from '../core/catalogue';
import { GOALS, type GoalDef, type GoalId, type GoalState } from '../core/goals';
import { GARLAND_SETS } from '../render/garland-sets';
import { computeLayout } from '../render/layout';
import { PALETTES, withPalette } from '../render/palettes';
import type { PathStyle } from '../render/paths';
import { SCENES, type SceneId } from '../render/scenes';
import {
  effectiveLook, type CursorKind, type Decor, type GarlandSet, type Look, type PaletteId, type PresentSet, type StrandKind, type TagStyle,
  type TopperKind, type TreeKind,
} from '../store/look';
import type { SavedLook } from '../store/saved-looks';
import {
  CURSOR_ART, DECOR_ART, garlandArt, PATH_ART, PRESENT_ART, SCENE_ART, STRAND_ART, TAG_ART, TOPPER_ART, TREE_ART,
} from './decorate-art';
import { count, formatMs } from './format';

export interface DecorateHandlers {
  /** The saved look (the drawer presses what the stage shows of it: effectiveLook). */
  look(): Look;
  onLook(patch: Partial<Look>): void;
  world(): 'secret' | 'home-alone' | null;
  owns(id: ItemId): boolean;
  goal(id: GoalId): GoalState | null;
  /** Signed out: a guest's device tracks the milestones alone. */
  guest(): boolean;
  /** Earned and not yet seen here: they wear a New pip while the drawer is open. */
  unseen(): ItemId[];
  /** The drawer opened: everything earned has now been seen. */
  onSeen(): void;
  /** The three saved looks, an empty slot null (src/store/saved-looks.ts). */
  looks(): (SavedLook | null)[];
  onSaveLook(slot: 0 | 1 | 2, name: string): void;
  onApplyLook(slot: 0 | 1 | 2): void;
}

/** One swatch: its item (none for a starter value), what it shows, whether the look has it, and the patch a pick sends. */
interface Item {
  id: string;
  def: ItemDef | undefined;
  label: string;
  art: string;
  on(l: Look): boolean;
  patch(l: Look): Partial<Look>;
}

interface Tile {
  b: HTMLButtonElement;
  item: Item;
  label: HTMLElement;
  lock: HTMLElement;
}

const GOAL: ReadonlyMap<GoalId, GoalDef> = new Map(GOALS.map((g) => [g.id, g]));

/**
 * What a locked item says: its goal, and how far along the player is ("Light 25 trees · 18/25", "A tree under 1:00 ·
 * best 1:12.4"). A guest's device tracks milestones only, so other goals ask them to sign in; a signed-in player whose
 * progress hasn't loaded sees the goal alone. A secret stays "???" until it is done.
 */
export function lockText(goal: GoalDef, state: GoalState | null, guest: boolean): string {
  if (goal.kind === 'secret' && !state?.done) return SECRET;
  if (guest && goal.kind !== 'milestone') return `${goal.text} · Sign in to track`;
  if (state === null || state.done) return goal.text;
  if (goal.kind === 'speed' || goal.kind === 'ao5') return state.have > 0 ? `${goal.text} · best ${formatMs(state.have)}` : goal.text;
  // A one-off goal has nothing to count.
  return goal.need > 1 ? `${goal.text} · ${count(state.have)}/${count(goal.need)}` : goal.text;
}

/** What a secret's locked swatch says, to the eye and to assistive tech. */
const SECRET = '???';

/** A small padlock over a locked swatch's dimmed art. Static markup. */
const LOCK_ART =
  '<svg viewBox="0 0 12 14" aria-hidden="true"><path d="M3.6 6.2V4.6a2.4 2.4 0 0 1 4.8 0v1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="1.6" y="6" width="8.8" height="7" rx="1.6" fill="currentColor"/></svg>';
const SLOTS = [0, 1, 2] as const;

const SCENE_ITEMS: readonly [SceneId, string][] = [
  ['fireside', 'Fireside'], ['midnight', 'Midnight'], ['sash', 'Sash'], ['square', 'Town square'], ['parlour', 'Parlour'], ['frost', 'Frost'],
];
// The aluminium tree is the lab's "tinsel" tree: named for its foil, so it doesn't read as the tinsel decoration.
const TREE_ITEMS: readonly [TreeKind, string][] = [['fir', 'Fir'], ['flocked', 'Flocked'], ['feather', 'Feather'], ['tinsel', 'Aluminium']];
const PATH_ITEMS: readonly [PathStyle, string][] = [['filament', 'Filament'], ['fairy', 'Fairy lights'], ['neon', 'Neon'], ['neonbright', 'Neon bright']];
const STRAND_ITEMS: readonly [StrandKind, string][] = [['bulbs', 'Bulbs'], ['bubble', 'Bubble'], ['c9', 'C9'], ['candle', 'Candles']];
const BULB_ITEMS: readonly [PaletteId, string][] = [
  ['scene', 'Scene'], ['gilded', 'Gilded'], ['golden', 'Golden'], ['classic', 'Classic'], ['candy', 'Candy'], ['emerald', 'Emerald'],
  ['ice', 'Ice'], ['snow', 'Snow'], ['sapphire', 'Sapphire'], ['goldsilver', 'Gold & silver'], ['pastel', 'Pastel'], ['peppermint', 'Peppermint'],
  ['rosegold', 'Rose gold'], ['copper', 'Copper'], ['disco', 'Disco'],
];
// The game's garland wears the tree's own bulbs: "Matching".
const GARLAND_ITEMS: readonly [GarlandSet, string][] = [
  ['game', 'Matching'], ['candlelight', 'Candlelight'], ['gold', 'Gold'], ['mercury', 'Mercury'], ['champagne', 'Champagne'], ['silver', 'Silver'],
  ['ice', 'Ice'], ['pastel', 'Pastel'], ['classic', 'Classic'], ['peppermint', 'Peppermint'], ['rosegold', 'Rose gold'],
];
const TOPPER_ITEMS: readonly [TopperKind, string][] = [
  ['snowflake', 'Snowflake'], ['star', 'Star'], ['silverstar', 'Silver star'], ['goldstar', 'Gold star'], ['angel', 'Angel'], ['bow', 'Bow'],
];
const DECOR_ITEMS: readonly [keyof Decor, string][] = [['tinsel', 'Tinsel'], ['beads', 'Beads'], ['canes', 'Candy canes'], ['skirt', 'Skirt']];
// The game's own set shows as "Festive", so it doesn't clash with the Classic bulbs.
const PRESENT_ITEMS: readonly [PresentSet, string][] = [
  ['none', 'None'], ['game', 'Festive'], ['luxe', 'Luxe'], ['kraft', 'Kraft'], ['silver', 'Silver'], ['tartan', 'Tartan'], ['starry', 'Starry'],
  ['candystripe', 'Candy stripe'], ['goldfoil', 'Gold foil'],
];
const TAG_ITEMS: readonly [TagStyle, string][] = [
  ['plain', 'Plain'], ['silver', 'Silver'], ['goldfoil', 'Gold foil'], ['velvet', 'Velvet'], ['tartan', 'Tartan'], ['holly', 'Holly'], ['plaid', 'Plaid'],
  ['ember', 'Ember'], ['frost', 'Frost'], ['gingerbread', 'Gingerbread'], ['snowflake', 'Snowflake'], ['kraft', 'Kraft'], ['candystripe', 'Candy stripe'],
  ['starry', 'Starry night'],
];
const CURSOR_ITEMS: readonly [CursorKind, string][] = [['plain', 'Plain cursor'], ['spark', 'Spark cursor']];

/** The pointer events the remap re-sends in stage coordinates while the stage is scaled into its frame. */
const REMAPPED = ['pointerdown', 'pointermove', 'pointerup', 'contextmenu', 'click', 'wheel'] as const;
/** The chrome that fades while decorating (decorate.css), kept out of reach of Tab too. */
const OUT_OF_REACH = '.hud, #keys-hint, .corner';

const WORLD_LINE = 'Your look comes back when you leave.';
/** Decision 10: a strand other than the bulbs brings its own wire, so the light path waits (dimmed) until it is back. */
const OWN_WIRE = 'Your strand brings its own wire.';

export class Decorate {
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private tiles: Tile[] = [];
  /** The Scene bulbs swatch's dots: they show the current scene's own colours. */
  private sceneDots: HTMLElement[] = [];
  /** The Matching garland swatch's bulbs: they show the bulbs on the tree (the scene's, or the look's palette). */
  private matchDots: SVGElement[] = [];
  private worldLine: HTMLElement | null = null;
  /** The Light path section and its note: dimmed while a strand brings its own wire (Decision 10). */
  private pathSection: HTMLElement | null = null;
  private pathNote: HTMLElement | null = null;
  /** The line above the footer that spells out a locked swatch's goal. */
  private hint: HTMLElement | null = null;
  private chips: HTMLButtonElement[] = [];
  private saveBtn: HTMLButtonElement | null = null;
  private saveForm: HTMLElement | null = null;
  private nameField: HTMLInputElement | null = null;
  /** Save is open: a chip takes the look instead of applying one. */
  private saving = false;
  private opened = false;
  /** The stage's transform: screen = (p − c)·s + c + t, with c the viewport's centre. */
  private xf = { s: 1, tx: 0, ty: 0 };
  private readonly stage: HTMLElement;
  /** The radio panel's and the app's phone breakpoint: below it the drawer is a bottom sheet (decorate.css). */
  private readonly phone = matchMedia('(max-width: 600px)');
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly h: DecorateHandlers) {
    const stage = document.getElementById('stage');
    if (!stage) throw new Error('#stage is missing from index.html');
    this.stage = stage;
    // Esc closes the drawer only, marked handled so the game doesn't pause (its keys stand aside while it's open).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.opened && !e.defaultPrevented) {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    if (!this.root) this.build();
    const root = this.root!;
    this.sync();
    this.markNew();
    document.body.classList.add('decorating');
    for (const n of document.querySelectorAll<HTMLElement>(OUT_OF_REACH)) n.inert = true;
    this.fit();
    for (const t of REMAPPED) addEventListener(t, this.remap, { capture: true, passive: false });
    addEventListener('resize', this.fit);
    root.inert = false;
    // The closed state is laid out first, so the drawer slides in (and nothing waits on a frame).
    void root.offsetWidth;
    for (const n of [root, this.backdrop!, this.frame!]) n.classList.add('open');
    const first = root.querySelector<HTMLElement>('.deco-sw[aria-pressed="true"]') ?? root.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    const active = document.activeElement;
    for (const t of REMAPPED) removeEventListener(t, this.remap, { capture: true });
    removeEventListener('resize', this.fit);
    document.body.classList.remove('decorating');
    for (const n of document.querySelectorAll<HTMLElement>(OUT_OF_REACH)) n.inert = false;
    for (const n of [this.root, this.backdrop, this.frame]) n?.classList.remove('open');
    if (this.root) this.root.inert = true;
    for (const n of this.root?.querySelectorAll('.deco-new') ?? []) n.remove();
    this.endSave();
    this.showHint(null);
    this.unfit();
    // The drawer opened from the settings menu: focus goes back to its button, unless the user moved it on purpose.
    if (this.root && active instanceof Node && this.root.contains(active)) document.getElementById('menu-btn')?.focus({ preventScroll: true });
  }

  /**
   * Press what the stage shows of the look (a locked choice stays saved, unpressed), lock what isn't earned with its
   * goal, and say so when an egg world keeps its own tree.
   */
  sync(): void {
    if (!this.root) return;
    const shown = effectiveLook(this.h.look(), (id) => this.h.owns(id));
    for (const t of this.tiles) {
      const lock = this.lockOf(t.item);
      t.b.setAttribute('aria-pressed', String(lock === null && t.item.on(shown)));
      t.b.classList.toggle('deco-locked', lock !== null);
      t.lock.hidden = lock === null;
      t.label.textContent = lock ?? t.item.label;
      // Still a button (a press spells out the goal), so its name says it is locked rather than aria-disabled. A secret's
      // name stays a secret: it says "???" as its label does.
      if (lock === null) t.b.removeAttribute('aria-label');
      else t.b.setAttribute('aria-label', lock === SECRET ? `${SECRET}, locked` : `${t.item.label}, locked: ${lock}`);
    }
    const own = SCENES[shown.scene].bulbs;
    this.sceneDots.forEach((b, i) => b.style.setProperty('--c', own[i % own.length]));
    const tree = withPalette(SCENES[shown.scene], shown.palette).bulbs;
    this.matchDots.forEach((b, i) => b.style.setProperty('--c', tree[i % tree.length]));
    this.worldLine!.hidden = this.h.world() === null;
    const ownWire = shown.strand !== 'bulbs';
    this.pathSection!.classList.toggle('deco-dim', ownWire);
    this.pathNote!.hidden = !ownWire;
    this.renderLooks();
  }

  /** The lock text for an item not earned yet; null for one the player owns (or a starter value). */
  private lockOf(item: Item): string | null {
    const def = item.def;
    if (!def || this.h.owns(def.id)) return null;
    return lockText(GOAL.get(def.goal)!, this.h.goal(def.goal), this.h.guest());
  }

  /** Pips on what was earned since the player last looked, for as long as the drawer stays open; then it's all seen. */
  private markNew(): void {
    const fresh = new Set<string>(this.h.unseen());
    for (const t of this.tiles) {
      if (!fresh.has(t.item.id) || t.b.querySelector('.deco-new')) continue;
      const pip = document.createElement('i');
      pip.className = 'deco-new';
      pip.textContent = 'New';
      t.b.append(pip);
    }
    this.h.onSeen();
  }

  private showHint(text: string | null): void {
    if (!this.hint) return;
    this.hint.hidden = text === null;
    this.hint.textContent = text ?? '';
  }

  /* ---------- saved looks ---------- */

  private renderLooks(): void {
    const looks = this.h.looks();
    this.chips.forEach((c, i) => {
      const l = looks[i] ?? null;
      c.textContent = l?.name ?? 'Empty';
      c.classList.toggle('empty', l === null);
      c.disabled = !this.saving && l === null;
      if (this.saving) c.setAttribute('aria-label', l ? `Save here, replacing ${l.name}` : `Save in slot ${i + 1}`);
      else c.removeAttribute('aria-label');
    });
    this.saveBtn!.textContent = this.saving ? 'Cancel' : 'Save';
    this.saveBtn!.setAttribute('aria-expanded', String(this.saving));
    this.saveForm!.hidden = !this.saving;
    this.root?.querySelector('.deco-looks')?.classList.toggle('saving', this.saving);
  }

  private startSave(): void {
    this.saving = true;
    this.nameField!.value = '';
    this.renderLooks();
    this.nameField!.focus({ preventScroll: true });
  }

  private endSave(): void {
    if (!this.saving) return;
    this.saving = false;
    this.renderLooks();
  }

  private pickSlot(slot: 0 | 1 | 2): void {
    if (this.saving) {
      this.h.onSaveLook(slot, this.nameField!.value);
      this.saving = false;
      this.renderLooks();
      this.chips[slot].focus({ preventScroll: true });
    } else if (this.h.looks()[slot]) {
      this.h.onApplyLook(slot);
      this.showHint(null);
      this.sync();
    }
  }

  /* ---------- the stage glides into a framed window ---------- */

  private readonly fit = (): void => {
    const W = innerWidth;
    const H = innerHeight;
    const L = computeLayout(W, H, 1);
    let area: { x: number; y: number; w: number; h: number };
    if (this.phone.matches) {
      const sheet = Math.min(H * 0.56, 520);
      area = { x: 12, y: 12, w: W - 24, h: H - sheet - 26 };
    } else {
      const drawer = Math.min(400, W * 0.34);
      area = { x: 24, y: 24, w: W - drawer - 24 - 24 - 24, h: H - 48 };
    }
    // The tree with its star, glow and presents: ~19.6 tiles wide, from 2.6 tiles above row 0 to 10.9 below.
    const s = Math.min(1, area.w / (19.6 * L.s), area.h / (13.5 * L.s));
    const fw = Math.min(area.w, W * s);
    const fh = Math.min(area.h, H * s);
    // Crop the canvas around the tree's middle (kept inside the canvas).
    const half = fh / s / 2;
    const cy = Math.max(half, Math.min(H - half, L.oy + 4.15 * L.s));
    const fx = area.x + (area.w - fw) / 2;
    const fy = area.y + (area.h - fh) / 2;
    // Put (W/2, cy) at the frame's centre.
    this.xf = { s, tx: fx + fw / 2 - W / 2, ty: fy + fh / 2 - H / 2 - (cy - H / 2) * s };
    const cropX = Math.max(0, (W - fw / s) / 2);
    const c = this.stage.style;
    c.transition = this.reduced.matches ? 'none' : 'transform .75s cubic-bezier(.2,.8,.2,1), clip-path .75s cubic-bezier(.2,.8,.2,1), filter .4s';
    c.transformOrigin = '50% 50%';
    c.transform = `translate(${this.xf.tx}px, ${this.xf.ty}px) scale(${s})`;
    c.clipPath = `inset(${Math.max(0, cy - half)}px ${cropX}px ${Math.max(0, H - cy - half)}px round ${20 / s}px)`;
    if (this.frame) Object.assign(this.frame.style, { left: `${fx}px`, top: `${fy}px`, width: `${fw}px`, height: `${fh}px` });
  };

  private unfit(): void {
    const c = this.stage.style;
    c.transform = '';
    this.xf = { s: 1, tx: 0, ty: 0 };
    const done = (): void => {
      if (this.opened) return;
      c.transition = '';
      c.clipPath = '';
      c.transformOrigin = '';
    };
    if (this.reduced.matches) return done();
    // The clip opens out with the glide back, then the stage's own styles return.
    c.clipPath = 'inset(0px 0px 0px round 0px)';
    setTimeout(done, 800);
  }

  /**
   * The game maps raw clientX/Y to tiles: while the stage is scaled, every pointer event on it (mouse, touch or pen) is
   * re-sent in the stage's own coordinates. Capture-phase on the window, so the game only ever sees the re-sent one.
   */
  private readonly remap = (e: Event): void => {
    if (!e.isTrusted || e.target !== this.stage) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const m = e as MouseEvent;
    const W = innerWidth;
    const H = innerHeight;
    const { s, tx, ty } = this.xf;
    const init: MouseEventInit = {
      bubbles: true, cancelable: true, clientX: (m.clientX - W / 2 - tx) / s + W / 2, clientY: (m.clientY - H / 2 - ty) / s + H / 2,
      button: m.button, buttons: m.buttons, ctrlKey: m.ctrlKey, shiftKey: m.shiftKey, altKey: m.altKey, metaKey: m.metaKey,
    };
    let ev: Event;
    if (e instanceof WheelEvent) ev = new WheelEvent(e.type, { ...init, deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode });
    else if (e instanceof PointerEvent)
      ev = new PointerEvent(e.type, { ...init, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, width: e.width, height: e.height, pressure: e.pressure });
    else ev = new MouseEvent(e.type, init);
    this.stage.dispatchEvent(ev);
  };

  /* ---------- the drawer ---------- */

  private build(): void {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'deco-backdrop';
    document.body.prepend(this.backdrop);
    this.frame = document.createElement('div');
    this.frame.className = 'deco-frame';
    this.frame.innerHTML = '<i class="deco-corner tl"></i><i class="deco-corner tr"></i><i class="deco-corner bl"></i><i class="deco-corner br"></i>';
    document.body.append(this.frame);
    const root = document.createElement('aside');
    root.className = 'deco';
    root.id = 'decorate';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Decorate the tree');
    root.inert = true;
    root.innerHTML = `
      <header class="deco-head"><small>Decorate</small><h2>Dress the tree</h2>
      <button class="deco-x" type="button" aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></header>
      <div class="deco-looks" role="group" aria-label="Saved looks">${SLOTS.map((i) => `<button type="button" class="deco-look" data-slot="${i}"></button>`).join('')}<button type="button" class="deco-save" aria-controls="deco-save-form">Save</button></div>
      <div class="deco-save-form" id="deco-save-form" hidden><input class="deco-name" type="text" maxlength="16" placeholder="Name this look" aria-label="Name this look" autocomplete="off" spellcheck="false" /><span>then pick a slot</span></div>
      <p class="deco-world" hidden>${WORLD_LINE}</p>
      <div class="deco-body"></div>
      <p class="deco-hint" role="status" hidden></p>
      <footer class="deco-foot"><button type="button" class="deco-done">Done</button></footer>`;
    // Taps inside the drawer are the drawer's: the menus' outside-tap closers never see them.
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.querySelector('.deco-x')!.addEventListener('click', () => this.close());
    root.querySelector('.deco-done')!.addEventListener('click', () => this.close());
    this.worldLine = root.querySelector('.deco-world');
    this.hint = root.querySelector('.deco-hint');
    this.chips = [...root.querySelectorAll<HTMLButtonElement>('.deco-look')];
    this.chips.forEach((c, i) => c.addEventListener('click', () => this.pickSlot(i as 0 | 1 | 2)));
    this.saveBtn = root.querySelector('.deco-save');
    this.saveBtn!.addEventListener('click', () => (this.saving ? this.endSave() : this.startSave()));
    this.saveForm = root.querySelector('.deco-save-form');
    this.nameField = root.querySelector('.deco-name');
    // Enter saves in the first empty slot; Esc puts the field away and leaves the drawer open (marked handled).
    this.nameField!.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.endSave();
        this.saveBtn!.focus({ preventScroll: true });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const empty = this.h.looks().findIndex((l) => l === null);
        if (empty >= 0) this.pickSlot(empty as 0 | 1 | 2);
      }
    });
    const body = root.querySelector<HTMLElement>('.deco-body')!;
    const item = (key: string, v: string, label: string, art: string, on: Item['on'], patch: Item['patch']): Item => {
      const id = `${key}:${v}`;
      return { id, def: itemOf(id), label, art, on, patch };
    };
    type Key = 'scene' | 'path' | 'palette' | 'strand' | 'tree' | 'topper' | 'presents' | 'garland' | 'tag' | 'cursor';
    const items = <V extends string>(list: readonly [V, string][], art: (v: V) => string, key: Key): Item[] =>
      list.map(([v, label]) => item(key, v, label, art(v), (l) => l[key] === v, () => ({ [key]: v }) as Partial<Look>));
    this.pathSection = this.section('Light path', 'What the wires become', 'strand', 3, items(PATH_ITEMS, (v) => PATH_ART[v], 'path'));
    this.pathNote = document.createElement('p');
    this.pathNote.className = 'deco-note';
    this.pathNote.textContent = OWN_WIRE;
    this.pathNote.hidden = true;
    this.pathSection.querySelector('h3')!.after(this.pathNote);
    body.append(
      this.section('Scene', 'Where it stands', 'scene', 4, items(SCENE_ITEMS, (v) => SCENE_ART[v], 'scene')),
      this.section('Tree', 'The tree itself', 'tree', 4, items(TREE_ITEMS, (v) => TREE_ART[v], 'tree')),
      this.pathSection,
      this.section('Strand', 'What the bulbs become', 'strand', 3, items(STRAND_ITEMS, (v) => STRAND_ART[v], 'strand')),
      this.section('Bulbs', 'Their colours', 'pal', 3, items(BULB_ITEMS, () => '<span class="deco-pal"></span>', 'palette')),
      this.section('Garland', 'Across the top', 'garl', 3, items(GARLAND_ITEMS, garlandArt, 'garland')),
      this.section('Topper', 'Crowning the tree', 'top', 4, items(TOPPER_ITEMS, (v) => TOPPER_ART[v], 'topper')),
      this.section('Decorations', 'Mix and match', 'decor', 4,
        // The toggle flips one flag of the saved look, so a locked decoration it has on stays on.
        DECOR_ITEMS.map(([k, label]) => item('decor', k, label, DECOR_ART[k], (l) => l.decor[k], (l) => ({ decor: { ...l.decor, [k]: !l.decor[k] } })))),
      this.section('Presents', 'Under the tree', 'gift', 4, items(PRESENT_ITEMS, (v) => PRESENT_ART[v], 'presents')),
      this.section('Tag', 'Your results', 'tag', 4, items(TAG_ITEMS, (v) => TAG_ART[v], 'tag')),
      this.section('Extras', 'The pointer', 'cursor', 4, items(CURSOR_ITEMS, (v) => CURSOR_ART[v], 'cursor')),
    );
    // The bulbs: six lit drops each, the Scene swatch's in the current scene's colours (sync).
    body.querySelectorAll<HTMLElement>('.deco-pal').forEach((pal, i) => {
      const id = BULB_ITEMS[i][0];
      for (let k = 0; k < 6; k++) {
        const b = document.createElement('b');
        if (id === 'scene') this.sceneDots.push(b);
        else b.style.setProperty('--c', PALETTES[id][k]);
        pal.append(b);
      }
    });
    // The garlands: each bulb in its set's colour, the Matching one's in the tree's bulbs (sync).
    for (const [id] of GARLAND_ITEMS) {
      const bulbs = [...body.querySelectorAll<SVGElement>(`.deco-sw[data-id="garland:${id}"] .deco-garl-g`)];
      if (id === 'game') this.matchDots.push(...bulbs);
      else bulbs.forEach((b, k) => b.style.setProperty('--c', GARLAND_SETS[id][k]));
    }
    document.body.append(root);
    this.root = root;
  }

  private section(title: string, hint: string, kind: string, cols: 3 | 4, list: Item[]): HTMLElement {
    const s = document.createElement('section');
    s.className = 'deco-sec';
    s.innerHTML = `<h3><span>${title}</span><i aria-hidden="true"></i><em>${hint}</em></h3>`;
    const grid = document.createElement('div');
    grid.className = `deco-grid deco-g${cols}`;
    for (const item of list) grid.append(this.tile(item, kind));
    s.append(grid);
    return s;
  }

  private tile(item: Item, kind: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `deco-sw deco-sw-${kind}`;
    b.dataset.id = item.id;
    b.innerHTML = `<span class="deco-sw-art">${item.art}<i class="deco-lock" hidden>${LOCK_ART}</i></span><span class="deco-sw-l">${item.label}</span>`;
    b.addEventListener('click', () => {
      // A locked swatch applies nothing: it spells out its goal above the footer.
      const lock = this.lockOf(item);
      this.showHint(lock);
      if (lock !== null) return;
      this.h.onLook(item.patch(this.h.look()));
      this.sync();
      b.classList.remove('deco-pop');
      void b.offsetWidth;
      b.classList.add('deco-pop');
    });
    this.tiles.push({ b, item, label: b.querySelector('.deco-sw-l')!, lock: b.querySelector('.deco-lock')! });
    return b;
  }
}
