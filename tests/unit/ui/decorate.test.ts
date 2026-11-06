// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Decorate, type DecorateHandlers } from '../../../src/ui/decorate';
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

function make(look: Look = LOOK, world: ReturnType<DecorateHandlers['world']> = null) {
  const h = { look: () => look, onLook: vi.fn(), world: () => world };
  const d = create(h);
  d.open();
  const sections = [...document.querySelectorAll<HTMLElement>('.deco-sec')];
  const tiles = (s: HTMLElement) => [...s.querySelectorAll<HTMLButtonElement>('.deco-sw')];
  const label = (b: HTMLElement) => b.querySelector('.deco-sw-l')!.textContent;
  const tile = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.deco-sw')].find((b) => label(b) === name)!;
  return { d, h, sections, tiles, label, tile };
}

it('six sections in order, with the current look pressed', () => {
  const { sections, tiles, label } = make();
  expect(sections.map((s) => s.querySelector('h3 span')!.textContent)).toEqual(['Scene', 'Light path', 'Bulbs', 'Topper', 'Decorations', 'Presents']);
  expect(sections.map((s) => tiles(s).map(label))).toEqual([
    ['Fireside', 'Midnight', 'Sash', 'Town square', 'Parlour', 'Frost'],
    ['Filament', 'Fairy lights', 'Neon'],
    ['Scene', 'Gilded', 'Classic', 'Ice', 'Gold & silver', 'Pastel'],
    ['Snowflake', 'Star', 'Angel', 'Bow'],
    ['Tinsel', 'Beads', 'Candy canes', 'Skirt'],
    ['None', 'Festive', 'Luxe', 'Kraft'],
  ]);
  const pressed = sections.map((s) => tiles(s).filter((b) => b.getAttribute('aria-pressed') === 'true').map(label));
  expect(pressed).toEqual([['Sash'], ['Neon'], ['Ice'], ['Bow'], ['Beads'], ['Festive']]);
  // No tree section and no Surprise button from the lab.
  expect(document.querySelector('[data-act="surprise"]')).toBeNull();
});

it('a pick calls onLook with one field, and a decoration toggles one flag', () => {
  const { h, tile } = make();
  tile('Midnight').click();
  tile('Fairy lights').click();
  tile('Gilded').click();
  tile('Angel').click();
  tile('Kraft').click();
  tile('Tinsel').click();
  tile('Beads').click();
  expect(h.onLook.mock.calls).toEqual([
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
  const d = create({ look: () => look, onLook: () => {}, world: () => null });
  d.open();
  const pressed = () => [...document.querySelectorAll('.deco-sw[aria-pressed="true"] .deco-sw-l')].map((n) => n.textContent);
  const sceneDots = () => [...document.querySelectorAll<HTMLElement>('.deco-sw-pal')[0].querySelectorAll('b')].map((b) => b.style.getPropertyValue('--c'));
  const sashDots = sceneDots();
  look = { ...LOOK, scene: 'frost', presents: 'none', decor: NO_DECOR };
  d.sync();
  expect(pressed()).toEqual(['Frost', 'Neon', 'Ice', 'Bow', 'None']);
  expect(sceneDots()).not.toEqual(sashDots);
  expect(sceneDots()).toHaveLength(6);
});

it('in a world it says the look comes back', () => {
  let world: 'secret' | 'home-alone' | null = 'home-alone';
  const d = create({ look: () => LOOK, onLook: () => {}, world: () => world });
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
  const d = create({ look: () => LOOK, onLook: () => {}, world: () => null });
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
