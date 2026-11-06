/**
 * The Decorate drawer (spec: Part B, from the lab's menus-decorate): one place to dress the tree, with painted swatches,
 * each pick applied live and saved. On desktop the stage glides into a framed window on the left so the drawer never
 * covers the tree, and the board stays playable there; on phones the stage rises above a bottom sheet.
 */
import { computeLayout } from '../render/layout';
import { PALETTES } from '../render/palettes';
import type { PathStyle } from '../render/paths';
import { SCENES, type SceneId } from '../render/scenes';
import type { Decor, Look, PaletteId, PresentSet, TopperKind } from '../store/look';
import { BOW_ART, DECOR_ART, PATH_ART, PRESENT_ART, SCENE_ART, TOPPER_ART } from './decorate-art';

export interface DecorateHandlers {
  look(): Look;
  onLook(patch: Partial<Look>): void;
  world(): 'secret' | 'home-alone' | null;
}

/** One swatch: what it shows, whether the look has it, and the one-field patch a pick sends. */
interface Item {
  label: string;
  art: string;
  on(l: Look): boolean;
  patch(l: Look): Partial<Look>;
}

const SCENE_ITEMS: readonly [SceneId, string][] = [['fireside', 'Fireside'], ['midnight', 'Midnight'], ['sash', 'Sash'], ['frost', 'Frost']];
const PATH_ITEMS: readonly [PathStyle, string][] = [['filament', 'Filament'], ['fairy', 'Fairy lights'], ['neon', 'Neon']];
const BULB_ITEMS: readonly [PaletteId, string][] = [
  ['scene', 'Scene'], ['gilded', 'Gilded'], ['classic', 'Classic'], ['ice', 'Ice'], ['goldsilver', 'Gold & silver'], ['pastel', 'Pastel'],
];
const TOPPER_ITEMS: readonly [TopperKind, string][] = [['snowflake', 'Snowflake'], ['star', 'Star'], ['angel', 'Angel'], ['bow', 'Bow']];
const DECOR_ITEMS: readonly [keyof Decor, string][] = [['tinsel', 'Tinsel'], ['beads', 'Beads'], ['canes', 'Candy canes'], ['skirt', 'Skirt']];
// The game's own set shows as "Festive", so it doesn't clash with the Classic bulbs.
const PRESENT_ITEMS: readonly [PresentSet, string][] = [['none', 'None'], ['game', 'Festive'], ['luxe', 'Luxe'], ['kraft', 'Kraft']];

/** The pointer events the remap re-sends in stage coordinates while the stage is scaled into its frame. */
const REMAPPED = ['pointerdown', 'pointermove', 'pointerup', 'contextmenu', 'click', 'wheel'] as const;
/** The chrome that fades while decorating (decorate.css), kept out of reach of Tab too. */
const OUT_OF_REACH = '.hud, #keys-hint, .corner';

const WORLD_LINE = 'Your look comes back when you leave.';

export class Decorate {
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private frame: HTMLElement | null = null;
  private tiles: { b: HTMLButtonElement; on: (l: Look) => boolean }[] = [];
  /** The Scene bulbs swatch's dots: they show the current scene's own colours. */
  private sceneDots: HTMLElement[] = [];
  private worldLine: HTMLElement | null = null;
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
    this.unfit();
    // The drawer opened from the settings menu: focus goes back to its button, unless the user moved it on purpose.
    if (this.root && active instanceof Node && this.root.contains(active)) document.getElementById('menu-btn')?.focus({ preventScroll: true });
  }

  /** Press what the look now holds, and say so when an egg world keeps its own tree. */
  sync(): void {
    if (!this.root) return;
    const l = this.h.look();
    for (const t of this.tiles) t.b.setAttribute('aria-pressed', String(t.on(l)));
    const own = SCENES[l.scene].bulbs;
    this.sceneDots.forEach((b, i) => b.style.setProperty('--c', own[i % own.length]));
    this.worldLine!.hidden = this.h.world() === null;
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
    root.innerHTML = `<div class="deco-band" aria-hidden="true"></div>${BOW_ART}
      <header class="deco-head"><small>Decorate</small><h2>Dress the tree</h2>
      <button class="deco-x" type="button" aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></header>
      <p class="deco-world" hidden>${WORLD_LINE}</p>
      <div class="deco-body"></div>
      <footer class="deco-foot"><button type="button" class="deco-done">Done</button></footer>`;
    // Taps inside the drawer are the drawer's: the menus' outside-tap closers never see them.
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.querySelector('.deco-x')!.addEventListener('click', () => this.close());
    root.querySelector('.deco-done')!.addEventListener('click', () => this.close());
    this.worldLine = root.querySelector('.deco-world');
    const body = root.querySelector<HTMLElement>('.deco-body')!;
    const items = <V extends string>(list: readonly [V, string][], art: (v: V) => string, key: 'scene' | 'path' | 'palette' | 'topper' | 'presents'): Item[] =>
      list.map(([v, label]) => ({ label, art: art(v), on: (l) => l[key] === v, patch: () => ({ [key]: v }) as Partial<Look> }));
    body.append(
      this.section('Scene', 'Where it stands', 'scene', 4, items(SCENE_ITEMS, (v) => SCENE_ART[v], 'scene')),
      this.section('Light path', 'What the wires become', 'strand', 3, items(PATH_ITEMS, (v) => PATH_ART[v], 'path')),
      this.section('Bulbs', 'Their colours', 'pal', 3, items(BULB_ITEMS, () => '<span class="deco-pal"></span>', 'palette')),
      this.section('Topper', 'Crowning the tree', 'top', 4, items(TOPPER_ITEMS, (v) => TOPPER_ART[v], 'topper')),
      this.section('Decorations', 'Mix and match', 'decor', 4,
        DECOR_ITEMS.map(([k, label]) => ({ label, art: DECOR_ART[k], on: (l) => l.decor[k], patch: (l) => ({ decor: { ...l.decor, [k]: !l.decor[k] } }) }))),
      this.section('Presents', 'Under the tree', 'gift', 4, items(PRESENT_ITEMS, (v) => PRESENT_ART[v], 'presents')),
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
    b.innerHTML = `<span class="deco-sw-art">${item.art}</span><span class="deco-sw-l">${item.label}</span>`;
    b.addEventListener('click', () => {
      this.h.onLook(item.patch(this.h.look()));
      this.sync();
      b.classList.remove('deco-pop');
      void b.offsetWidth;
      b.classList.add('deco-pop');
    });
    this.tiles.push({ b, on: item.on });
    return b;
  }
}
