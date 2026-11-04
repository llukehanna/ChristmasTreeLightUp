// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { everyWhileVisible } from '../../../src/ui/visible';

let hidden = false;
const setHidden = (h: boolean): void => {
  hidden = h;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  hidden = false;
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => vi.useRealTimers());

it('ticks while visible', () => {
  const fn = vi.fn();
  const stop = everyWhileVisible(fn, 100);
  vi.advanceTimersByTime(300);
  expect(fn).toHaveBeenCalledTimes(3);
  stop();
});

it('no ticks while hidden', () => {
  const fn = vi.fn();
  const stop = everyWhileVisible(fn, 100);
  vi.advanceTimersByTime(100);
  expect(fn).toHaveBeenCalledTimes(1);
  setHidden(true);
  vi.advanceTimersByTime(1000);
  expect(fn).toHaveBeenCalledTimes(1);
  stop();
});

it('one catch-up tick on return, then resumes', () => {
  const fn = vi.fn();
  const stop = everyWhileVisible(fn, 100);
  setHidden(true);
  vi.advanceTimersByTime(1000);
  setHidden(false);
  expect(fn).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(100);
  expect(fn).toHaveBeenCalledTimes(2);
  stop();
});

it('starts no timer when created in a hidden tab, and catches up on show', () => {
  hidden = true;
  const fn = vi.fn();
  const stop = everyWhileVisible(fn, 100);
  vi.advanceTimersByTime(1000);
  expect(fn).not.toHaveBeenCalled();
  setHidden(false);
  expect(fn).toHaveBeenCalledTimes(1);
  stop();
});

it('stop() clears everything', () => {
  const fn = vi.fn();
  const stop = everyWhileVisible(fn, 100);
  stop();
  vi.advanceTimersByTime(1000);
  setHidden(true);
  setHidden(false);
  vi.advanceTimersByTime(1000);
  expect(fn).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
