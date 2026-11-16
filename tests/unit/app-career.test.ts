// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CareerResponse } from '../../src/api/types';
import type { CareerOptions, CareerPage } from '../../src/career';
import { CareerOpener, type CareerOpenerHooks } from '../../src/career-opener';

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

type Kit = typeof import('../../src/career');
/** The chunk as the opener sees it: openCareer records each page it opens and the options it was given. */
function fakeKit(): { kit: Kit; pages: { opts: CareerOptions; close: ReturnType<typeof vi.fn> }[] } {
  const pages: { opts: CareerOptions; close: ReturnType<typeof vi.fn> }[] = [];
  const kit = {
    openCareer: (opts: CareerOptions): CareerPage => {
      const el = document.createElement('div');
      el.className = 'career';
      document.body.append(el);
      const close = vi.fn(() => el.remove());
      pages.push({ opts, close });
      return { el, close };
    },
  } as unknown as Kit;
  return { kit, pages };
}

const res: CareerResponse = { runs: [], best: null, inTop: 0, total: 0 };
const makeHooks = (user: { name: string | null } | null = { name: 'Comet' }) => ({
  user: vi.fn<CareerOpenerHooks['user']>(() => user),
  load: vi.fn<CareerOpenerHooks['load']>(async () => res),
  signIn: vi.fn<CareerOpenerHooks['signIn']>(),
  cover: vi.fn<CareerOpenerHooks['cover']>(),
  uncover: vi.fn<CareerOpenerHooks['uncover']>(),
  leaderboard: vi.fn<CareerOpenerHooks['leaderboard']>(),
  watch: vi.fn<CareerOpenerHooks['watch']>(),
  failed: vi.fn<CareerOpenerHooks['failed']>(),
});

let opener: CareerOpener | null = null;
beforeEach(() => {
  history.replaceState(null, '');
});
afterEach(() => {
  opener?.dispose();
  opener = null;
  document.body.innerHTML = '';
});

it('a guest gets the sign-in sheet, and no page, chunk or history entry', async () => {
  const hooks = makeHooks(null);
  const chunk = vi.fn(async () => fakeKit().kit);
  opener = new CareerOpener(hooks, chunk);
  const from = document.createElement('button');
  const length = history.length;
  opener.open(from);
  await tick();
  expect(hooks.signIn).toHaveBeenCalledWith(from);
  expect(chunk).not.toHaveBeenCalled();
  expect(hooks.cover).not.toHaveBeenCalled();
  expect(opener.state).toEqual({ open: false, loading: false });
  expect(history.length).toBe(length);
});

it('opening covers the stage, pushes one history entry with no URL change, and opens the page once the chunk is in', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  const chunk = deferred<Kit>();
  opener = new CareerOpener(hooks, () => chunk.promise);
  const url = location.href;
  const length = history.length;
  opener.open();
  expect(opener.state).toEqual({ open: false, loading: true });
  expect(opener.isOpen).toBe(true);
  expect(opener.covering).toBe(false); // the stage is still on screen until the page is
  expect(hooks.cover).toHaveBeenCalledTimes(1);
  expect(history.state).toEqual({ career: true });
  expect(history.length).toBe(length + 1);
  expect(location.href).toBe(url);
  chunk.resolve(kit);
  await tick();
  expect(pages).toHaveLength(1);
  expect(opener.state).toEqual({ open: true, loading: false });
  expect(opener.covering).toBe(true);
  // Covered again as the page lands: anything opened (or resumed) while the chunk loaded goes.
  expect(hooks.cover).toHaveBeenCalledTimes(2);
  expect(pages[0].opts.user).toEqual({ name: 'Comet' });
  await pages[0].opts.load();
  expect(hooks.load).toHaveBeenCalledTimes(1);
});

it('Review Focus 4: two opens before the chunk lands give one page and one history entry', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  const chunk = deferred<Kit>();
  const load = vi.fn(() => chunk.promise);
  opener = new CareerOpener(hooks, load);
  const length = history.length;
  opener.open();
  opener.open();
  chunk.resolve(kit);
  await tick();
  opener.open(); // and once more with the page up
  await tick();
  expect(pages).toHaveLength(1);
  expect(load).toHaveBeenCalledTimes(1);
  expect(history.length).toBe(length + 1);
  expect(document.querySelectorAll('.career')).toHaveLength(1);
});

it('Review Focus 4: closed while the chunk loads, no page opens when it lands, and no error is shown', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  const chunk = deferred<Kit>();
  opener = new CareerOpener(hooks, () => chunk.promise);
  opener.open();
  opener.close();
  expect(opener.state).toEqual({ open: false, loading: false });
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  chunk.resolve(kit);
  await tick();
  expect(pages).toHaveLength(0);
  expect(document.querySelector('.career')).toBeNull();
  expect(hooks.failed).not.toHaveBeenCalled();
  expect(hooks.cover).toHaveBeenCalledTimes(1);
  // A failure that lands after the close is not shown either.
  const failing = deferred<Kit>();
  const other = new CareerOpener(hooks, () => failing.promise);
  other.open();
  other.close();
  failing.reject(new Error('offline'));
  await tick();
  expect(hooks.failed).not.toHaveBeenCalled();
  other.dispose();
});

it('a chunk that fails to load says so, drops the history entry and uncovers; the next open asks for the chunk again', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  const chunk = vi.fn<() => Promise<Kit>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(kit);
  opener = new CareerOpener(hooks, chunk);
  const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
  opener.open();
  await tick();
  expect(hooks.failed).toHaveBeenCalledTimes(1);
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  expect(back).toHaveBeenCalledTimes(1);
  expect(opener.state).toEqual({ open: false, loading: false });
  back.mockRestore();
  history.replaceState(null, '');
  opener.open();
  await tick();
  expect(chunk).toHaveBeenCalledTimes(2);
  expect(pages).toHaveLength(1);
});

it('the page asks to close (‹ Tree, Esc): it closes, the history entry is gone, and the stage is uncovered with focus back where it came from', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  opener = new CareerOpener(hooks, async () => kit);
  const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
  const from = document.createElement('button');
  opener.open(from);
  await tick();
  pages[0].opts.onClose();
  expect(pages[0].close).toHaveBeenCalledTimes(1);
  expect(back).toHaveBeenCalledTimes(1);
  expect(hooks.uncover).toHaveBeenCalledWith(from);
  expect(opener.state).toEqual({ open: false, loading: false });
  expect(opener.covering).toBe(false);
  // Asked twice (Esc, then a click on ‹ Tree): closed once.
  pages[0].opts.onClose();
  expect(back).toHaveBeenCalledTimes(1);
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  back.mockRestore();
});

it('browser Back (popstate) closes the page without going back again', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  opener = new CareerOpener(hooks, async () => kit);
  opener.open();
  await tick();
  const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
  history.replaceState(null, ''); // where Back lands: the entry before ours
  dispatchEvent(new PopStateEvent('popstate', { state: null }));
  expect(pages[0].close).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  expect(opener.state).toEqual({ open: false, loading: false });
  // Back again, with nothing open: nothing happens.
  dispatchEvent(new PopStateEvent('popstate', { state: null }));
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  back.mockRestore();
});

it('Back while the chunk loads cancels the open', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  const chunk = deferred<Kit>();
  opener = new CareerOpener(hooks, () => chunk.promise);
  opener.open();
  history.replaceState(null, '');
  dispatchEvent(new PopStateEvent('popstate', { state: null }));
  chunk.resolve(kit);
  await tick();
  expect(pages).toHaveLength(0);
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
});

it("Watch closes the page and replaces the history entry (no Back racing the replay), then plays the run", async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  opener = new CareerOpener(hooks, async () => kit);
  const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
  const length = history.length;
  opener.open();
  await tick();
  pages[0].opts.onWatch('run-42');
  expect(pages[0].close).toHaveBeenCalledTimes(1);
  expect(back).not.toHaveBeenCalled();
  expect(history.state).toBeNull();
  expect(history.length).toBe(length + 1);
  expect(hooks.watch).toHaveBeenCalledWith('run-42');
  expect(hooks.uncover.mock.invocationCallOrder[0]).toBeLessThan(hooks.watch.mock.invocationCallOrder[0]);
  // A later Back lands on the entry before: nothing to close.
  dispatchEvent(new PopStateEvent('popstate', { state: null }));
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  back.mockRestore();
});

it('Leaderboard closes the page, then opens the leaderboard sheet', async () => {
  const hooks = makeHooks();
  const { kit, pages } = fakeKit();
  opener = new CareerOpener(hooks, async () => kit);
  const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
  opener.open();
  await tick();
  pages[0].opts.onLeaderboard();
  expect(pages[0].close).toHaveBeenCalledTimes(1);
  expect(back).toHaveBeenCalledTimes(1);
  expect(hooks.leaderboard).toHaveBeenCalledTimes(1);
  expect(hooks.uncover.mock.invocationCallOrder[0]).toBeLessThan(hooks.leaderboard.mock.invocationCallOrder[0]);
  back.mockRestore();
});

it('Escape while the chunk loads closes the open (and its history entry); with the page up or nothing open it does nothing', async () => {
  const hooks = makeHooks();
  const { kit } = fakeKit();
  const chunk = deferred<Kit>();
  opener = new CareerOpener(hooks, () => chunk.promise);
  expect(opener.closeIfLoading()).toBe(false);
  opener.open();
  expect(opener.closeIfLoading()).toBe(true);
  expect(opener.state).toEqual({ open: false, loading: false });
  expect(hooks.uncover).toHaveBeenCalledTimes(1);
  // The chunk landing late opens nothing.
  chunk.resolve(kit);
  await tick();
  expect(opener.state).toEqual({ open: false, loading: false });
  expect(document.querySelectorAll('.career')).toHaveLength(0);
  // With the page up the page takes Escape itself.
  const second = makeHooks();
  opener.dispose();
  opener = new CareerOpener(second, async () => kit);
  opener.open();
  await tick();
  expect(opener.closeIfLoading()).toBe(false);
  expect(opener.state.open).toBe(true);
});
