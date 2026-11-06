// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ITEMS } from '../../../src/core/catalogue';
import { GOALS, type GoalId, type GoalState } from '../../../src/core/goals';
import { GARLAND_SETS } from '../../../src/render/garland-sets';
import { PALETTES } from '../../../src/render/palettes';
import { Decorate, lockText, type DecorateHandlers } from '../../../src/ui/decorate';
import { NO_DECOR, STARTER_LOOK, type Look } from '../../../src/store/look';

beforeEach(() => {
  document.body.innerHTML = '<canvas id="stage"></canvas><div class="hud"></div>';
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});
/** Every drawer made here: closed after each test, as their Esc listeners stay on the document. */
const made: Decorate[] = [];
const create = (h: DecorateHandlers): Decorate => {
  const d = new Decorate(h);
  made.push(d);
  return d;
};
afterEach(() => {
  for (const d of made.splice(0)) d.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const LOOK: Look = {
  ...STARTER_LOOK, scene: 'sash', path: 'neon', palette: 'ice', topper: 'bow', decor: { ...NO_DECOR, beads: true }, presents: 'game',
};

/** Handlers that own everything, with nothing new and no saved looks, unless a test says otherwise. */
const handlers = (over: Partial<DecorateHandlers> = {}) => ({
  look: () => LOOK,
  onLook: vi.fn(),
  world: (): ReturnType<DecorateHandlers['world']> => null,
  owns: () => true,
  goal: (): GoalState | null => null,
  guest: () => false,
  unseen: () => [],
  onSeen: vi.fn(),
  looks: () => [null, null, null],
  onSaveLook: vi.fn(),
  onApplyLook: vi.fn(),
  ...over,
});

function make(look: Look = LOOK, world: ReturnType<DecorateHandlers['world']> = null, over: Partial<DecorateHandlers> = {}) {
  const h = handlers({ look: () => look, world: () => world, ...over });
  const d = create(h);
  d.open();
  const sections = [...document.querySelectorAll<HTMLElement>('.deco-sec')];
  const tiles = (s: HTMLElement) => [...s.querySelectorAll<HTMLButtonElement>('.deco-sw')];
  const label = (b: HTMLElement) => b.querySelector('.deco-sw-l')!.textContent;
  const tile = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.deco-sw')].find((b) => label(b) === name)!;
  return { d, h, sections, tiles, label, tile };
}

it('eleven sections in order, with the current look pressed', () => {
  const { sections, tiles, label } = make();
  expect(sections.map((s) => s.querySelector('h3 span')!.textContent)).toEqual([
    'Scene', 'Tree', 'Light path', 'Strand', 'Bulbs', 'Garland', 'Topper', 'Decorations', 'Presents', 'Tag', 'Extras',
  ]);
  expect(sections.map((s) => s.querySelector('h3 em')!.textContent)).toContain('What the bulbs become');
  expect(sections.map((s) => s.querySelector('h3 em')!.textContent)).toContain('The tree itself');
  expect(sections.map((s) => s.querySelector('h3 em')!.textContent)).toContain('Across the top');
  expect(sections.map((s) => s.querySelector('h3 em')!.textContent)).toContain('Your results');
  expect(sections.map((s) => tiles(s).map(label))).toEqual([
    ['Fireside', 'Midnight', 'Sash', 'Town square', 'Parlour', 'Frost'],
    ['Fir', 'Flocked', 'Feather', 'Aluminium'],
    ['Filament', 'Fairy lights', 'Neon', 'Neon bright'],
    ['Bulbs', 'Bubble', 'C9', 'Candles'],
    ['Scene', 'Gilded', 'Golden', 'Classic', 'Candy', 'Emerald', 'Ice', 'Snow', 'Sapphire', 'Gold & silver', 'Pastel', 'Peppermint', 'Rose gold', 'Copper', 'Disco'],
    ['Matching', 'Candlelight', 'Gold', 'Mercury', 'Champagne', 'Silver', 'Ice', 'Pastel', 'Classic', 'Peppermint', 'Rose gold'],
    ['Snowflake', 'Star', 'Silver star', 'Gold star', 'Angel', 'Bow'],
    ['Tinsel', 'Beads', 'Candy canes', 'Skirt'],
    ['None', 'Festive', 'Luxe', 'Kraft', 'Silver', 'Tartan', 'Starry', 'Candy stripe', 'Gold foil'],
    ['Plain', 'Silver', 'Gold foil', 'Velvet', 'Tartan', 'Holly', 'Plaid', 'Ember', 'Frost', 'Gingerbread', 'Snowflake', 'Kraft', 'Candy stripe', 'Starry night'],
    ['Plain cursor', 'Spark cursor'],
  ]);
  const pressed = sections.map((s) => tiles(s).filter((b) => b.getAttribute('aria-pressed') === 'true').map(label));
  expect(pressed).toEqual([['Sash'], ['Fir'], ['Neon'], ['Bulbs'], ['Ice'], ['Matching'], ['Bow'], ['Beads'], ['Festive'], ['Plain'], ['Plain cursor']]);
  // No tree section and no Surprise button from the lab.
  expect(document.querySelector('[data-act="surprise"]')).toBeNull();
});

it('a swatch for every catalogue item whose slot the drawer shows (the catalogue and the art cannot drift)', () => {
  make();
  const shown = new Set(['scene', 'path', 'palette', 'strand', 'tree', 'garland', 'topper', 'decor', 'presents', 'tag', 'cursor']);
  const items = ITEMS.filter((i) => shown.has(i.slot));
  expect(items.length).toBeGreaterThan(60);
  for (const i of items) expect(byId(i.id), i.id).not.toBeNull();
  // Each swatch has its art: no empty thumbnails.
  for (const b of document.querySelectorAll<HTMLElement>('.deco-sw')) expect(b.querySelector('.deco-sw-art')!.children.length, b.dataset.id).toBeGreaterThan(1);
});

it('a garland and a tag pick send one field; the Matching garland shows the bulbs on the tree', () => {
  const { h, tile, sections } = make();
  byId('garland:champagne').click();
  byId('tag:velvet').click();
  expect(vi.mocked(h.onLook).mock.calls).toEqual([[{ garland: 'champagne' }], [{ tag: 'velvet' }]]);
  expect(tile('Matching').dataset.id).toBe('garland:game');
  const dots = (id: string) => [...byId(id).querySelectorAll<HTMLElement>('[style]')].map((n) => n.style.getPropertyValue('--c'));
  // LOOK has the Ice bulbs: the Matching garland wears them; a set wears its own.
  expect(dots('garland:game')).toEqual([...PALETTES.ice]);
  expect(dots('garland:gold')).toEqual([...GARLAND_SETS.gold]);
  expect(sections).toHaveLength(11);
});

it("a locked secret's swatch says ??? to assistive tech too, never its name", () => {
  make(LOOK, null, { owns: (id) => !['palette:disco', 'tag:plaid', 'tag:ember'].includes(id) });
  for (const id of ['palette:disco', 'tag:plaid', 'tag:ember']) {
    const b = byId(id);
    expect(b.querySelector('.deco-sw-l')!.textContent).toBe('???');
    expect(b.getAttribute('aria-label'), id).toBe('???, locked');
    expect(b.textContent).not.toMatch(/Disco|Plaid|Ember/);
  }
});

it('a pick calls onLook with one field, and a decoration toggles one flag', () => {
  const { h, tile } = make();
  tile('Midnight').click();
  tile('Fairy lights').click();
  tile('Gilded').click();
  tile('Angel').click();
  byId('presents:kraft').click();
  tile('Tinsel').click();
  tile('Beads').click();
  expect(vi.mocked(h.onLook).mock.calls).toEqual([
    [{ scene: 'midnight' }],
    [{ path: 'fairy' }],
    [{ palette: 'gilded' }],
    [{ topper: 'angel' }],
    [{ presents: 'kraft' }],
    [{ decor: { ...NO_DECOR, beads: true, tinsel: true } }],
    [{ decor: { ...NO_DECOR, beads: false } }],
  ]);
});

it('sync presses what the look now holds, and the Scene bulbs follow the scene', () => {
  let look = LOOK;
  const d = create(handlers({ look: () => look }));
  d.open();
  const pressed = () => [...document.querySelectorAll('.deco-sw[aria-pressed="true"] .deco-sw-l')].map((n) => n.textContent);
  const sceneDots = () => [...document.querySelectorAll<HTMLElement>('.deco-sw-pal')[0].querySelectorAll('b')].map((b) => b.style.getPropertyValue('--c'));
  const sashDots = sceneDots();
  look = { ...LOOK, scene: 'frost', presents: 'none', decor: NO_DECOR };
  d.sync();
  expect(pressed()).toEqual(['Frost', 'Fir', 'Neon', 'Bulbs', 'Ice', 'Matching', 'Bow', 'None', 'Plain', 'Plain cursor']);
  expect(sceneDots()).not.toEqual(sashDots);
  expect(sceneDots()).toHaveLength(6);
});

it('in a world it says the look comes back', () => {
  let world: 'secret' | 'home-alone' | null = 'home-alone';
  const d = create(handlers({ world: () => world }));
  d.open();
  const line = document.querySelector<HTMLElement>('.deco-world')!;
  expect(line.hidden).toBe(false);
  expect(line.textContent).toBe('Your look comes back when you leave.');
  world = null;
  d.sync();
  expect(line.hidden).toBe(true);
  world = 'secret';
  d.sync();
  expect(line.hidden).toBe(false);
});

it('Esc closes the drawer and is marked handled (the game does not pause)', () => {
  const { d } = make();
  expect(d.isOpen).toBe(true);
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  expect(d.isOpen).toBe(false);
  expect(e.defaultPrevented).toBe(true);
  // Closed, Esc is the game's again.
  const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.body.dispatchEvent(again);
  expect(again.defaultPrevented).toBe(false);
});

it('the pointer remap listens only while the drawer is open', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const d = create(handlers());
  const captured = (spy: typeof add) => spy.mock.calls.filter((c) => c[0] === 'pointerdown' && (c[2] === true || (c[2] as AddEventListenerOptions)?.capture));
  expect(captured(add)).toHaveLength(0);
  d.open();
  expect(captured(add)).toHaveLength(1);
  d.close();
  expect(captured(remove)).toHaveLength(1);
  expect(remove.mock.calls.find((c) => c[0] === 'pointerdown')![1]).toBe(captured(add)[0][1]);
});

it('opening glides the stage into the frame, and closing lets it go', () => {
  const { d } = make();
  const stage = document.getElementById('stage')!;
  expect(document.body.classList.contains('decorating')).toBe(true);
  expect(stage.style.transform).toMatch(/scale\(/);
  expect(stage.style.clipPath).toMatch(/^inset\(/);
  expect(document.querySelector<HTMLElement>('.hud')!.inert).toBe(true);
  d.close();
  expect(document.body.classList.contains('decorating')).toBe(false);
  expect(stage.style.transform).toBe('');
  expect(document.querySelector<HTMLElement>('.hud')!.inert).toBe(false);
});

const goalOf = (id: GoalId) => GOALS.find((g) => g.id === id)!;
const byId = (id: string) => document.querySelector<HTMLButtonElement>(`.deco-sw[data-id="${id}"]`)!;
const hint = () => document.querySelector<HTMLElement>('.deco-hint')!;

it('lockText: milestones count, speed shows the best, a guest is asked to sign in, a secret is ???', () => {
  const st = (have: number, need: number, done = false): GoalState => ({ have, need, done });
  expect(lockText(goalOf('m25'), st(18, 25), false)).toBe('Light 25 trees · 18/25');
  expect(lockText(goalOf('m25'), st(18, 25), true)).toBe('Light 25 trees · 18/25');
  expect(lockText(goalOf('m1000'), st(18, 1000), true)).toBe('Light 1,000 trees · 18/1,000');
  expect(lockText(goalOf('s60'), st(72_400, 60_000), false)).toBe('A tree under 1:00 · best 1:12.4');
  expect(lockText(goalOf('s60'), st(0, 60_000), false)).toBe('A tree under 1:00');
  expect(lockText(goalOf('a45'), st(51_000, 45_000), false)).toBe('Average of 5 under 0:45 · best 0:51.0');
  expect(lockText(goalOf('streak7'), st(2, 7), false)).toBe('Play the Daily Tree 7 days in a row · 2/7');
  // A one-off has nothing to count.
  expect(lockText(goalOf('perfect'), st(0, 1), false)).toBe('A tree in its minimum turns');
  // A guest's device can't tell; a signed-in player's progress still loading shows the goal alone.
  expect(lockText(goalOf('streak7'), null, true)).toBe('Play the Daily Tree 7 days in a row · Sign in to track');
  expect(lockText(goalOf('streak7'), null, false)).toBe('Play the Daily Tree 7 days in a row');
});

it("a secret's swatch says ??? until its goal is done", () => {
  for (const guest of [false, true]) {
    expect(lockText(goalOf('eggSecret'), { have: 0, need: 1, done: false }, guest)).toBe('???');
    expect(lockText(goalOf('eggSecret'), null, guest)).toBe('???');
    expect(lockText(goalOf('fireplace100'), { have: 40, need: 100, done: false }, guest)).toBe('???');
  }
  expect(lockText(goalOf('eggSecret'), { have: 1, need: 1, done: true }, false)).toBe('A tree in secret mode');
});

it('a locked swatch is dimmed, says its goal and progress, and a click applies nothing', () => {
  const goal = vi.fn((id: GoalId): GoalState | null => (id === 'm25' ? { have: 12, need: 25, done: false } : null));
  const { h, label } = make(LOOK, null, { owns: (id) => id !== 'path:neon' && id !== 'topper:bow', goal });
  const neon = byId('path:neon');
  expect(neon.classList.contains('deco-locked')).toBe(true);
  expect(neon.querySelector('.deco-lock')).not.toBeNull();
  expect(label(neon)).toBe('Light 25 trees · 12/25');
  expect(neon.getAttribute('aria-label')).toBe('Neon, locked: Light 25 trees · 12/25');
  // The stage shows Filament and the Snowflake in their place: those are what is pressed.
  expect(neon.getAttribute('aria-pressed')).toBe('false');
  expect(byId('path:filament').getAttribute('aria-pressed')).toBe('true');
  expect(byId('topper:snowflake').getAttribute('aria-pressed')).toBe('true');
  // A starter swatch is never locked.
  expect(byId('path:filament').classList.contains('deco-locked')).toBe(false);
  expect(hint().hidden).toBe(true);
  neon.click();
  expect(h.onLook).not.toHaveBeenCalled();
  expect(hint().hidden).toBe(false);
  expect(hint().textContent).toBe('Light 25 trees · 12/25');
  // An owned pick goes through, and puts the hint away.
  byId('path:fairy').click();
  expect(h.onLook).toHaveBeenCalledWith({ path: 'fairy' });
  expect(hint().hidden).toBe(true);
});

it('a decoration toggle keeps a locked decoration the saved look has on', () => {
  const look: Look = { ...LOOK, decor: { ...NO_DECOR, beads: true } };
  const { h } = make(look, null, { owns: (id) => id !== 'decor:beads' });
  expect(byId('decor:beads').getAttribute('aria-pressed')).toBe('false');
  byId('decor:tinsel').click();
  expect(h.onLook).toHaveBeenCalledWith({ decor: { ...NO_DECOR, beads: true, tinsel: true } });
});

it('an earned, unseen swatch wears a New pip; opening the drawer calls onSeen once', () => {
  let unseen: string[] = ['scene:midnight', 'decor:tinsel'];
  const onSeen = vi.fn(() => (unseen = []));
  const { d } = make(LOOK, null, { unseen: () => unseen as never, onSeen });
  expect(onSeen).toHaveBeenCalledTimes(1);
  const pips = () => [...document.querySelectorAll('.deco-sw .deco-new')].map((n) => n.closest<HTMLElement>('.deco-sw')!.dataset.id);
  expect(pips()).toEqual(['scene:midnight', 'decor:tinsel']);
  expect(document.querySelector('.deco-new')!.textContent).toBe('New');
  d.sync(); // still open: the pips stay
  expect(pips()).toHaveLength(2);
  d.close();
  expect(pips()).toEqual([]);
  d.open();
  expect(onSeen).toHaveBeenCalledTimes(2);
  expect(pips()).toEqual([]);
});

it('three saved looks: save names a slot, apply sends the whole look', () => {
  let looks: ReturnType<DecorateHandlers['looks']> = [{ name: 'Cosy', look: LOOK }, null, null];
  const onSaveLook = vi.fn((slot: 0 | 1 | 2, name: string) => {
    looks = looks.map((l, i) => (i === slot ? { name: name || `Look ${slot + 1}`, look: LOOK } : l));
  });
  const { h } = make(LOOK, null, { looks: () => looks, onSaveLook });
  const chips = () => [...document.querySelectorAll<HTMLButtonElement>('.deco-look')];
  const field = () => document.querySelector<HTMLInputElement>('.deco-name')!;
  expect(chips().map((c) => c.textContent)).toEqual(['Cosy', 'Empty', 'Empty']);
  // Under the header, before the sections.
  const head = document.querySelector('.deco-head')!;
  const row = document.querySelector('.deco-looks')!;
  expect(head.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(chips()[1].disabled).toBe(true);

  chips()[0].click();
  expect(h.onApplyLook).toHaveBeenCalledWith(0);

  // Save opens the name field; a slot then takes it.
  expect(field().closest<HTMLElement>('.deco-save-form')!.hidden).toBe(true);
  document.querySelector<HTMLButtonElement>('.deco-save')!.click();
  expect(field().closest<HTMLElement>('.deco-save-form')!.hidden).toBe(false);
  expect(field().maxLength).toBe(16);
  expect(chips().every((c) => !c.disabled)).toBe(true);
  field().value = 'Party time';
  chips()[2].click();
  expect(onSaveLook).toHaveBeenCalledWith(2, 'Party time');
  expect(h.onApplyLook).toHaveBeenCalledTimes(1);
  expect(field().closest<HTMLElement>('.deco-save-form')!.hidden).toBe(true);
  expect(chips().map((c) => c.textContent)).toEqual(['Cosy', 'Empty', 'Party time']);

  // Enter saves in the first empty slot; Esc only closes the field, not the drawer.
  document.querySelector<HTMLButtonElement>('.deco-save')!.click();
  field().value = '';
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(onSaveLook).toHaveBeenLastCalledWith(1, '');
  document.querySelector<HTMLButtonElement>('.deco-save')!.click();
  const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  field().dispatchEvent(esc);
  expect(field().closest<HTMLElement>('.deco-save-form')!.hidden).toBe(true);
  expect(document.querySelector('#decorate')!.classList.contains('open')).toBe(true);
});

it('a strand, a tree and the cursor are picked like any slot, and a locked one says its goal', () => {
  const { h } = make(LOOK, null, { owns: (id) => id !== 'tree:tinsel' });
  byId('strand:candle').click();
  byId('tree:feather').click();
  byId('cursor:spark').click();
  expect(vi.mocked(h.onLook).mock.calls).toEqual([[{ strand: 'candle' }], [{ tree: 'feather' }], [{ cursor: 'spark' }]]);
  byId('tree:tinsel').click();
  expect(vi.mocked(h.onLook)).toHaveBeenCalledTimes(3);
  expect(byId('tree:tinsel').classList.contains('deco-locked')).toBe(true);
  expect(document.querySelector('.deco-hint')!.textContent).toMatch(/1,000|1000/);
});

it('Decision 10: with a strand other than the bulbs, the Light path section is dimmed with its note', () => {
  const pathSection = () => byId('path:filament').closest<HTMLElement>('.deco-sec')!;
  const note = () => pathSection().querySelector<HTMLElement>('.deco-note')!;
  const d = make({ ...LOOK, strand: 'bubble' }).d;
  expect(pathSection().classList.contains('deco-dim')).toBe(true);
  expect(note().hidden).toBe(false);
  expect(note().textContent).toBe('Your strand brings its own wire.');
  d.close();
  made.splice(0);
  document.body.innerHTML = '<canvas id="stage"></canvas><div class="hud"></div>';
  make({ ...LOOK, strand: 'bulbs' });
  expect(pathSection().classList.contains('deco-dim')).toBe(false);
  expect(note().hidden).toBe(true);
});

it('Decision 10 follows what the stage shows: a strand not owned yet dims nothing', () => {
  make({ ...LOOK, strand: 'c9' }, null, { owns: (id) => id !== 'strand:c9' });
  const sec = byId('path:filament').closest<HTMLElement>('.deco-sec')!;
  expect(sec.classList.contains('deco-dim')).toBe(false);
});
