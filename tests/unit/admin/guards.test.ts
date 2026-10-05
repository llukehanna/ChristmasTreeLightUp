import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mustWarnBeforeLeaving } from '../../../src/admin/leave';
import { watchdog } from '../../../src/admin/watchdog';

describe('mustWarnBeforeLeaving', () => {
  it('warns while anything would be lost: unsaved edits, uploads in the queue, or a save in flight', () => {
    expect(mustWarnBeforeLeaving({ dirty: false, busy: false, saving: false })).toBe(false);
    expect(mustWarnBeforeLeaving({ dirty: true, busy: false, saving: false })).toBe(true);
    expect(mustWarnBeforeLeaving({ dirty: false, busy: true, saving: false })).toBe(true);
    expect(mustWarnBeforeLeaving({ dirty: false, busy: false, saving: true })).toBe(true);
  });
});

describe('watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the given quiet time, not before', () => {
    const stalled = vi.fn();
    watchdog(120_000, stalled);
    vi.advanceTimersByTime(119_999);
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stalled).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000_000);
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('every poke (progress) restarts the quiet time', () => {
    const stalled = vi.fn();
    const dog = watchdog(120_000, stalled);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(100_000);
      dog.poke();
    }
    expect(stalled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120_000);
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('stop (completion) disarms it for good', () => {
    const stalled = vi.fn();
    const dog = watchdog(120_000, stalled);
    vi.advanceTimersByTime(60_000);
    dog.stop();
    dog.poke();
    vi.advanceTimersByTime(1_000_000);
    expect(stalled).not.toHaveBeenCalled();
  });
});
