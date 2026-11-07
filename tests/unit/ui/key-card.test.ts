// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { cardFit, KeyCard } from '../../../src/ui/key-card';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  document.body.className = '';
  host = document.getElementById('host')!;
});

/** A card with room for the wide width, as on a roomy window. */
function make(): KeyCard {
  const k = new KeyCard(host);
  k.fit(244);
  return k;
}
const card = () => host.querySelector<HTMLElement>('.key-card')!;
const rows = () => [...host.querySelectorAll('li')].map((li) => li.querySelector('.kc-label')!.textContent);
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

it('renders the title and the six rows in order, with the secret in the footer', () => {
  const k = make();
  k.show();
  expect(card().querySelector('.kc-kicker')!.textContent).toBe('From the workshop');
  expect(card().querySelector('h2')!.textContent).toBe('Little helpers');
  expect(rows()).toEqual(['Turn a wire', 'Turn it back', 'A new tree', 'Pause', 'Ghost on or off', 'This card']);
  expect(card().querySelector('.kc-secret span')!.textContent).toBe('Some trees keep secrets.');
  // Two mouse pictures, N, Esc and P, G, Tab.
  expect(card().querySelectorAll('svg.kc-mouse')).toHaveLength(2);
  expect([...card().querySelectorAll('kbd')].map((c) => c.textContent)).toEqual(['N', 'Esc', 'P', 'G', 'Tab', '?']);
});

it('show() opens it and hide() closes it', () => {
  const k = make();
  expect(k.open).toBe(false);
  k.show();
  expect(k.open).toBe(true);
  expect(card().classList.contains('show')).toBe(true);
  k.hide();
  expect(k.open).toBe(false);
  expect(card().classList.contains('show')).toBe(false);
});

it('a pinned card survives hide() from a Tab keyup, and Escape closes it', () => {
  const k = make();
  k.pin();
  expect(k.open).toBe(true);
  k.hide();
  expect(k.open).toBe(true);
  esc();
  expect(k.open).toBe(false);
  expect(card().classList.contains('pinned')).toBe(false);
});

it('Escape on a pinned card is swallowed so the pause never sees it; unpinned, it passes through', () => {
  const k = make();
  let seen = 0;
  document.addEventListener('keydown', () => seen++);
  k.show();
  esc();
  expect(seen).toBe(1);
  expect(k.open).toBe(true);
  k.pin();
  esc();
  expect(seen).toBe(1);
  expect(k.open).toBe(false);
});

it('the x button and close() close a pinned card', () => {
  const k = make();
  k.pin();
  card().querySelector<HTMLButtonElement>('.kc-x')!.click();
  expect(k.open).toBe(false);
  k.pin();
  k.close();
  expect(k.open).toBe(false);
});

it('marks the body while it is open (the hint steps aside) and has no "soon" anywhere', () => {
  const k = make();
  k.show();
  expect(document.body.classList.contains('keys-on')).toBe(true);
  expect(host.textContent!.toLowerCase()).not.toContain('soon');
  expect(host.innerHTML.toLowerCase()).not.toContain('soon');
  k.hide();
  expect(document.body.classList.contains('keys-on')).toBe(false);
});

it('builds once, however often it is shown', () => {
  const k = make();
  k.show();
  k.hide();
  k.show();
  expect(host.querySelectorAll('.key-card')).toHaveLength(1);
});

it('fit(0) closes an open card, clears pinned and keys-on, and a later Escape is not swallowed', () => {
  const k = make();
  k.pin();
  expect(document.body.classList.contains('keys-on')).toBe(true);
  k.fit(0);
  expect(k.open).toBe(false);
  expect(k.isPinned).toBe(false);
  expect(document.body.classList.contains('keys-on')).toBe(false);
  let seen = 0;
  document.addEventListener('keydown', () => seen++);
  esc();
  expect(seen).toBe(1);
});

it('is off until it has a width, and 200 gives the slim card', () => {
  const k = new KeyCard(host);
  k.show();
  expect(k.open).toBe(false);
  expect(k.fitted).toBe(false);
  expect(document.body.classList.contains('keys-off')).toBe(true);
  k.fit(200);
  expect(k.fitted).toBe(true);
  expect(document.body.classList.contains('keys-off')).toBe(false);
  k.show();
  expect(card().classList.contains('slim')).toBe(true);
  k.fit(244);
  expect(card().classList.contains('slim')).toBe(false);
});

const C = (width: 244 | 200 | 0, dock: 'centre' | 'high' = 'centre') => ({ width, dock });
const NONE = Infinity; // no room for that dock at all

it('cardFit: a touch-only device gets no card at any width', () => {
  expect(cardFit(1440, 100, 100, true)).toEqual(C(0));
  expect(cardFit(1440, 100, 100, false)).toEqual(C(244));
  expect(cardFit(2000, NONE, 100, true)).toEqual(C(0));
});

it('cardFit, centred: 244 when it clears the tree by 12 px, else 200; always off below 900 px', () => {
  expect(cardFit(1440, 1180, NONE)).toEqual(C(244)); // 1196 - 1180 = 16
  expect(cardFit(1440, 1184, NONE)).toEqual(C(244)); // exactly 12
  expect(cardFit(1440, 1185, NONE)).toEqual(C(200)); // 244 is 11 short, 200 clears (1240)
  expect(cardFit(1440, 1228, NONE)).toEqual(C(200)); // exactly 12 for the slim card
  expect(cardFit(1440, 1229, NONE)).toEqual(C(0));
  expect(cardFit(899, 100, 100)).toEqual(C(0));
  expect(cardFit(900, 100, NONE)).toEqual(C(244));
  expect(cardFit(1100, 880, NONE)).toEqual(C(200)); // 244 would start at 856, inside the tree; 200 starts at 900
  expect(cardFit(1100, 900, NONE)).toEqual(C(0));
});

it('cardFit, docked high: tried when neither centred width clears, 244 first, then 200, then off', () => {
  // Centred is blocked (edge 1300 at 1440); high has the narrower top of the tree.
  expect(cardFit(1440, 1300, 1100)).toEqual(C(244, 'high'));
  expect(cardFit(1440, 1300, 1228)).toEqual(C(200, 'high'));
  expect(cardFit(1440, 1300, 1229)).toEqual(C(0));
  // Centred wins whenever it fits, even slim, ahead of a wide card docked high.
  expect(cardFit(1440, 1185, 900)).toEqual(C(200));
  expect(cardFit(1440, 1100, 900)).toEqual(C(244));
  // Below 900 px there is no card in either dock.
  expect(cardFit(850, 900, 100)).toEqual(C(0));
});

it('a high card is told where its top is, and a centred one drops that', () => {
  const k = make();
  k.fit(244, 'high', 132);
  k.show();
  expect(card().classList.contains('high')).toBe(true);
  expect(card().style.getPropertyValue('--kc-top')).toBe('132px');
  k.fit(200, 'centre');
  expect(card().classList.contains('high')).toBe(false);
  expect(card().classList.contains('slim')).toBe(true);
});
