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
      <button id="decorate-btn">Decorate</button>
      <button id="keys-row">Keyboard shortcuts</button>
      <input type="range" id="effects-volume" />
      <label id="haptics-row"><input type="checkbox" id="haptics" /></label>
    </div>
    <canvas id="stage"></canvas>`;
});
afterEach(() => vi.useRealTimers());

function make(needsConfirm: boolean) {
  const onNewTree = vi.fn();
  const menu = new Menu({ ...DEFAULT_SETTINGS }, { onChange: () => {}, onDecorate: () => {}, onNewTree, needsConfirm: () => needsConfirm });
  return { menu, onNewTree };
}

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
  const menu = new Menu({ ...DEFAULT_SETTINGS }, { onChange: () => {}, onDecorate: () => {}, onNewTree: () => {}, needsConfirm: () => false, onKeys });
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
    onChange: () => {}, onDecorate: () => {}, onNewTree: () => {}, needsConfirm: () => false, onOpen: () => order.push(menu.isOpen ? 'open' : 'before'),
  });
  menu.open();
  expect(order).toEqual(['before']);
});

it('Decorate closes the menu, then opens the drawer', () => {
  const order: string[] = [];
  const menu = new Menu({ ...DEFAULT_SETTINGS }, {
    onChange: () => {}, onDecorate: () => order.push(menu.isOpen ? 'menu open' : 'menu closed'), onNewTree: () => {}, needsConfirm: () => false,
  });
  menu.open();
  (document.getElementById('decorate-btn') as HTMLButtonElement).click();
  expect(order).toEqual(['menu closed']);
  expect(document.querySelector('.seg')).toBeNull();
});
