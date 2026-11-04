// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Menu } from '../../../src/ui/menu';
import { DEFAULT_SETTINGS } from '../../../src/store/settings';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <button id="menu-btn"></button>
    <div id="menu" hidden>
      <div class="seg" data-setting="scene"><button data-value="auto"></button></div>
      <button id="new-tree">New tree</button>
      <input type="range" id="effects-volume" />
      <label id="haptics-row"><input type="checkbox" id="haptics" /></label>
    </div>
    <canvas id="stage"></canvas>`;
});
afterEach(() => vi.useRealTimers());

function make(needsConfirm: boolean) {
  const onNewTree = vi.fn();
  const menu = new Menu({ ...DEFAULT_SETTINGS }, { onChange: () => {}, onNewTree, needsConfirm: () => needsConfirm });
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
