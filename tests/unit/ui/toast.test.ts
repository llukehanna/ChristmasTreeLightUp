// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('showWhenSeen: a toast for a hidden tab waits to be seen', () => {
  let hidden = false;
  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => {
    delete (document as { hidden?: boolean }).hidden;
  });
  const show = (h: boolean) => {
    hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('in a visible tab, shows at once', () => {
    const toast = new Toast(node);
    toast.showWhenSeen("Couldn't reach the Daily Tree · playing a random one", 3600);
    expect(node.classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(3600);
    expect(node.classList.contains('show')).toBe(false);
  });

  it('in a hidden tab, waits for the tab to be shown, then stays its usual time', () => {
    hidden = true;
    const toast = new Toast(node);
    toast.showWhenSeen("Not your first go today · this one won't rank", 3600);
    expect(node.classList.contains('show')).toBe(false);
    vi.advanceTimersByTime(60_000); // unseen time doesn't count against it
    show(true); // still hidden
    expect(node.classList.contains('show')).toBe(false);
    show(false);
    expect(node.textContent).toBe("Not your first go today · this one won't rank");
    expect(node.classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(3599);
    expect(node.classList.contains('show')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(node.classList.contains('show')).toBe(false);
    // Shown once: a later hide and show brings nothing back.
    show(true);
    show(false);
    expect(node.classList.contains('show')).toBe(false);
  });

  it('a waiting toast is dropped by hide() or by a newer toast', () => {
    hidden = true;
    const toast = new Toast(node);
    toast.showWhenSeen('old', 3600);
    toast.hide();
    show(false);
    expect(node.classList.contains('show')).toBe(false);
    show(true);
    toast.showWhenSeen('older', 3600);
    toast.show('newer', 3000);
    show(false);
    expect(node.textContent).toBe('newer');
  });
});
