// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { KeyCard } from '../../../src/ui/key-card';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  document.body.className = '';
  host = document.getElementById('host')!;
});

const card = () => host.querySelector<HTMLElement>('.key-card')!;
const rows = () => [...host.querySelectorAll('li')].map((li) => li.querySelector('.kc-label')!.textContent);
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

it('renders the title and the five rows in order, with the secret in the footer', () => {
  const k = new KeyCard(host);
  k.show();
  expect(card().querySelector('.kc-kicker')!.textContent).toBe('From the workshop');
  expect(card().querySelector('h2')!.textContent).toBe('Little helpers');
  expect(rows()).toEqual(['Turn a wire', 'Turn it back', 'A new tree', 'Pause', 'This card']);
  expect(card().querySelector('.kc-secret span')!.textContent).toBe('Some trees keep secrets.');
  // Two mouse pictures, N, Esc and P, Tab.
  expect(card().querySelectorAll('svg.kc-mouse')).toHaveLength(2);
  expect([...card().querySelectorAll('kbd')].map((c) => c.textContent)).toEqual(['N', 'Esc', 'P', 'Tab', '?']);
});

it('show() opens it and hide() closes it', () => {
  const k = new KeyCard(host);
  expect(k.open).toBe(false);
  k.show();
  expect(k.open).toBe(true);
  expect(card().classList.contains('show')).toBe(true);
  k.hide();
  expect(k.open).toBe(false);
  expect(card().classList.contains('show')).toBe(false);
});

it('a pinned card survives hide() from a Tab keyup, and Escape closes it', () => {
  const k = new KeyCard(host);
  k.pin();
  expect(k.open).toBe(true);
  k.hide();
  expect(k.open).toBe(true);
  esc();
  expect(k.open).toBe(false);
  expect(card().classList.contains('pinned')).toBe(false);
});

it('Escape on a pinned card is swallowed so the pause never sees it; unpinned, it passes through', () => {
  const k = new KeyCard(host);
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
  const k = new KeyCard(host);
  k.pin();
  card().querySelector<HTMLButtonElement>('.kc-x')!.click();
  expect(k.open).toBe(false);
  k.pin();
  k.close();
  expect(k.open).toBe(false);
});

it('marks the body while it is open (the hint steps aside) and has no "soon" anywhere', () => {
  const k = new KeyCard(host);
  k.show();
  expect(document.body.classList.contains('keys-on')).toBe(true);
  expect(host.textContent!.toLowerCase()).not.toContain('soon');
  expect(host.innerHTML.toLowerCase()).not.toContain('soon');
  k.hide();
  expect(document.body.classList.contains('keys-on')).toBe(false);
});

it('builds once, however often it is shown', () => {
  const k = new KeyCard(host);
  k.show();
  k.hide();
  k.show();
  expect(host.querySelectorAll('.key-card')).toHaveLength(1);
});
