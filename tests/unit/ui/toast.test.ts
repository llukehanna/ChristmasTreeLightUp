// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Toast } from '../../../src/ui/toast';

let node: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  node = document.createElement('div');
});
afterEach(() => vi.useRealTimers());

it('shows its text and goes after its time', () => {
  const toast = new Toast(node);
  toast.show('Press N again for a new tree', 3000);
  expect(node.textContent).toBe('Press N again for a new tree');
  expect(node.classList.contains('show')).toBe(true);
  vi.advanceTimersByTime(3000);
  expect(node.classList.contains('show')).toBe(false);
});

it('hide() takes it away at once, and a later toast is not cut short by the old timer', () => {
  const toast = new Toast(node);
  toast.show('first', 3000);
  vi.advanceTimersByTime(1000);
  toast.hide();
  expect(node.classList.contains('show')).toBe(false);
  toast.show('second', 3000);
  vi.advanceTimersByTime(2500); // the first toast's timer would have fired at 3,000 ms from the start
  expect(node.classList.contains('show')).toBe(true);
});
