// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Menu, NEW_TREE_CONFIRM_MS } from '../../../src/ui/menu';
import { DEFAULT_SETTINGS } from '../../../src/store/settings';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <button id="menu-btn"></button>
    <div id="menu" hidden>
      <button id="new-tree">New tree</button>
      <button id="daily-row"><span id="daily-label">Daily Tree</span><span id="daily-note" hidden>Played</span></button>
      <button id="decorate-btn">Decorate</button>
      <button id="keys-row">Keyboard shortcuts</button>
      <input type="range" id="effects-volume" />
      <label id="haptics-row"><input type="checkbox" id="haptics" /></label>
    </div>
    <canvas id="stage"></canvas>`;
});
afterEach(() => vi.useRealTimers());

function make(needsConfirm: boolean, played: () => boolean = () => false) {
  const onNewTree = vi.fn();
  const onDaily = vi.fn();
  const menu = new Menu({ ...DEFAULT_SETTINGS }, { onChange: () => {}, onDecorate: () => {}, onNewTree, onDaily, dailyPlayed: played, needsConfirm: () => needsConfirm });
  return { menu, onNewTree, onDaily };
}
const label = () => document.getElementById('daily-label')?.textContent;
const note = () => document.getElementById('daily-note') as HTMLElement;

it('starts a tree at once when no confirm is needed', () => {
  const { menu, onNewTree } = make(false);
  expect(menu.requestNewTree()).toBe('started');
  expect(onNewTree).toHaveBeenCalledTimes(1);
});

it('arms on the first call, starts on a second inside the window, and arms again after it', () => {
  const { menu, onNewTree } = make(true);
  expect(menu.requestNewTree()).toBe('armed');
  expect(onNewTree).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(menu.requestNewTree()).toBe('started');
  expect(onNewTree).toHaveBeenCalledTimes(1);

  // The window is 3,000 ms: a later call arms afresh.
  const second = make(true);
  expect(second.menu.requestNewTree()).toBe('armed');
  vi.advanceTimersByTime(3100);
  expect(second.menu.requestNewTree()).toBe('armed');
  expect(second.onNewTree).not.toHaveBeenCalled();
});

it('the menu button arms and starts through the same flow', () => {
  const { onNewTree } = make(true);
  const btn = document.getElementById('new-tree') as HTMLButtonElement;
  btn.click();
  expect(onNewTree).not.toHaveBeenCalled();
  expect(btn.textContent).toBe('Tap again to start over');
  btn.click();
  expect(onNewTree).toHaveBeenCalledTimes(1);
});

it('the Keyboard shortcuts row closes the menu, then asks for the key card', () => {
  const onKeys = vi.fn();
  const menu = new Menu({ ...DEFAULT_SETTINGS }, { onChange: () => {}, onDecorate: () => {}, onNewTree: () => {}, onDaily: () => {}, needsConfirm: () => false, onKeys });
  menu.open();
  (document.getElementById('keys-row') as HTMLButtonElement).click();
  expect(menu.isOpen).toBe(false);
  expect(onKeys).toHaveBeenCalledTimes(1);
});

it('the confirm window is NEW_TREE_CONFIRM_MS (3,000 ms), which the N toast shares', () => {
  expect(NEW_TREE_CONFIRM_MS).toBe(3000);
  const { menu, onNewTree } = make(true);
  menu.requestNewTree();
  vi.advanceTimersByTime(NEW_TREE_CONFIRM_MS - 10);
  expect(menu.requestNewTree()).toBe('started');
  expect(onNewTree).toHaveBeenCalledTimes(1);
  const late = make(true);
  late.menu.requestNewTree();
  vi.advanceTimersByTime(NEW_TREE_CONFIRM_MS + 10);
  expect(late.menu.requestNewTree()).toBe('armed');
});

it('opening the menu tells the host first (it closes whatever would sit over the menu)', () => {
  const order: string[] = [];
  const menu = new Menu({ ...DEFAULT_SETTINGS }, {
    onChange: () => {}, onDecorate: () => {}, onNewTree: () => {}, onDaily: () => {}, needsConfirm: () => false, onOpen: () => order.push(menu.isOpen ? 'open' : 'before'),
  });
  menu.open();
  expect(order).toEqual(['before']);
});

it('Decorate closes the menu, then opens the drawer', () => {
  const order: string[] = [];
  const menu = new Menu({ ...DEFAULT_SETTINGS }, {
    onChange: () => {}, onDecorate: () => order.push(menu.isOpen ? 'menu open' : 'menu closed'), onNewTree: () => {}, onDaily: () => {}, needsConfirm: () => false,
  });
  menu.open();
  (document.getElementById('decorate-btn') as HTMLButtonElement).click();
  expect(order).toEqual(['menu closed']);
  expect(document.querySelector('.seg')).toBeNull();
});

it('the Daily Tree row starts the Daily at once when nothing is at stake, and closes the menu', () => {
  const { menu, onDaily, onNewTree } = make(false);
  menu.open();
  (document.getElementById('daily-row') as HTMLButtonElement).click();
  expect(onDaily).toHaveBeenCalledTimes(1);
  expect(onNewTree).not.toHaveBeenCalled();
  expect(menu.isOpen).toBe(false);
});

it('mid-run the Daily Tree row asks the same 3 s confirm as New tree, armed on its own', () => {
  const { menu, onDaily, onNewTree } = make(true);
  const row = document.getElementById('daily-row') as HTMLButtonElement;
  const newTree = document.getElementById('new-tree') as HTMLButtonElement;
  row.click();
  expect(onDaily).not.toHaveBeenCalled();
  expect(label()).toBe('Tap again to start over');
  expect(row.classList.contains('armed')).toBe(true);
  expect(newTree.textContent).toBe('New tree');
  // New tree is not armed by the Daily's first tap: it arms for itself.
  expect(menu.requestNewTree()).toBe('armed');
  expect(onNewTree).not.toHaveBeenCalled();
  expect(label()).toBe('Daily Tree');
  expect(menu.request('daily')).toBe('armed');
  vi.advanceTimersByTime(NEW_TREE_CONFIRM_MS - 10);
  expect(menu.request('daily')).toBe('started');
  expect(onDaily).toHaveBeenCalledTimes(1);
  // Past the window, it arms afresh.
  const late = make(true);
  expect(late.menu.request('daily')).toBe('armed');
  vi.advanceTimersByTime(NEW_TREE_CONFIRM_MS + 10);
  expect(late.menu.request('daily')).toBe('armed');
  expect(late.onDaily).not.toHaveBeenCalled();
});

it("the Daily Tree row says Played once this device has started today's Daily, checked each time the menu opens", () => {
  let played = false;
  const { menu, onDaily } = make(false, () => played);
  menu.open();
  expect(note().hidden).toBe(true);
  menu.close();
  // Started today's (or midnight passed): the next open shows it.
  played = true;
  menu.open();
  expect(note().hidden).toBe(false);
  expect(note().textContent).toBe('Played');
  expect(label()).toBe('Daily Tree');
  // It still starts the Daily (a repeat).
  (document.getElementById('daily-row') as HTMLButtonElement).click();
  expect(onDaily).toHaveBeenCalledTimes(1);
  // A new day: the note goes at the next open.
  played = false;
  menu.open();
  expect(note().hidden).toBe(true);
});

it('the Played note steps aside while the row asks to confirm', () => {
  const { menu } = make(true, () => true);
  menu.open();
  menu.request('daily');
  expect(label()).toBe('Tap again to start over');
  expect(note().hidden).toBe(true);
  vi.advanceTimersByTime(NEW_TREE_CONFIRM_MS + 100);
  expect(label()).toBe('Daily Tree');
  expect(note().hidden).toBe(false);
});
