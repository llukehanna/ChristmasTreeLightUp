// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../../src/api/session';
import type { User } from '../../../src/api/types';
import { loadStarHead, saveStarHead } from '../../../src/store/star-head';
import { STAR_TAP_GAP_MS, StarEgg, StarTaps, TypedWord, starHeadFor, type EggHooks } from '../../../src/ui/star-egg';

const user = (starHead: boolean, name: string | null = 'Comet'): User => ({ name, isAdmin: false, starHead });

describe('StarTaps', () => {
  it('the fifth tap within 1.6 s of each other toggles, and the count starts over', () => {
    const taps = new StarTaps();
    expect([0, 300, 600, 900].map((t) => taps.tap(t))).toEqual([1, 2, 3, 4]);
    expect(taps.tap(1200)).toBe(5);
    // Five more bring it back: the count restarts straight after a toggle.
    expect([1500, 1800, 2100, 2400, 2700].map((t) => taps.tap(t))).toEqual([1, 2, 3, 4, 5]);
  });

  it('exactly 1.6 s between taps still counts; a longer gap starts over', () => {
    const taps = new StarTaps();
    taps.tap(0);
    expect(taps.tap(STAR_TAP_GAP_MS)).toBe(2);
    expect(taps.tap(STAR_TAP_GAP_MS * 2 + 1)).toBe(1);
    for (const t of [4000, 4100, 4200]) taps.tap(t);
    expect(taps.tap(6000)).toBe(1);
  });

  it('count is the taps so far toward the next toggle (the e2e probe reads it)', () => {
    const taps = new StarTaps();
    expect(taps.count).toBe(0);
    for (const t of [0, 100, 200]) taps.tap(t);
    expect(taps.count).toBe(3);
    taps.tap(300);
    taps.tap(400);
    expect(taps.count).toBe(0);
    taps.tap(500);
    taps.tap(500 + STAR_TAP_GAP_MS + 1);
    expect(taps.count).toBe(1);
  });
});

describe('TypedWord("hohoho")', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, target: document.body, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra });
  const type = (w: TypedWord, text: string, t0 = 0, extra: Partial<KeyboardEvent> = {}) => [...text].map((c, i) => w.feed(key(c, extra), t0 + i * 120));

  it('matches the word on its last letter, in any case, then starts over', () => {
    const w = new TypedWord('hohoho');
    expect(type(w, 'hohoho')).toEqual([false, false, false, false, false, true]);
    expect(type(w, 'HoHoHO', 2000).at(-1)).toBe(true);
    // A seventh and eighth letter don't toggle it again.
    expect(type(w, 'hohohoho', 4000).filter(Boolean)).toHaveLength(1);
  });

  it('letters only: Shift, spaces and other keys are ignored; other letters break the word', () => {
    const w = new TypedWord('hohoho');
    expect(type(w, 'ho ho ho').at(-1)).toBe(true);
    expect(w.feed(key('Shift'), 5000)).toBe(false);
    expect(type(w, 'hohxoho', 6000).some(Boolean)).toBe(false);
  });

  it('never while typing into a field, with a modifier held, or from a held-down key', () => {
    const w = new TypedWord('hohoho');
    for (const target of [document.createElement('input'), document.createElement('textarea')]) {
      expect(type(w, 'hohoho', 0, { target }).some(Boolean)).toBe(false);
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(type(w, 'hohoho', 1000, { target: editable }).some(Boolean)).toBe(false);
    expect(type(w, 'hohoho', 2000, { metaKey: true }).some(Boolean)).toBe(false);
    expect(type(w, 'hohoho', 3000, { repeat: true }).some(Boolean)).toBe(false);
  });

  it('a long pause starts the word over', () => {
    const w = new TypedWord('hohoho');
    type(w, 'hoho');
    expect([w.feed(key('h'), 5000), w.feed(key('o'), 5100)]).toEqual([false, false]);
  });
});

describe('the preference', () => {
  beforeEach(() => localStorage.clear());

  it('the browser keeps it as aglow.starHead = true, or nothing', () => {
    expect(loadStarHead()).toBe(false);
    saveStarHead(true);
    expect(localStorage.getItem('aglow.starHead')).toBe('true');
    expect(loadStarHead()).toBe(true);
    saveStarHead(false);
    expect(localStorage.getItem('aglow.starHead')).toBeNull();
    localStorage.setItem('aglow.starHead', '"yes"');
    expect(loadStarHead()).toBe(false);
  });

  it("signed in, the account's value wins; signed out (or not known yet), the browser's", () => {
    expect(starHeadFor(true, user(false))).toBe(false);
    expect(starHeadFor(false, user(true))).toBe(true);
    expect(starHeadFor(true, null)).toBe(true);
    expect(starHeadFor(true, undefined)).toBe(true);
    expect(starHeadFor(false, null)).toBe(false);
  });
});

describe('StarEgg', () => {
  let now = 0;
  let saved: boolean[];
  let puts: boolean[];
  let put: (on: boolean) => Promise<unknown>;
  let loads: boolean;
  const hooks = () => {
    const topper = { load: vi.fn(async () => loads), set: vi.fn(), flip: vi.fn(), tap: vi.fn() };
    const sfx = { starTap: vi.fn(), jingle: vi.fn() };
    const toast = vi.fn();
    const h: EggHooks = {
      topper,
      sfx,
      toast,
      vibrate: vi.fn(),
      save: (on) => saved.push(on),
      put: (on) => {
        puts.push(on);
        return put(on);
      },
      now: () => now,
    };
    return { h, topper, sfx, toast };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const fiveTaps = (egg: StarEgg) => {
    for (let k = 0; k < 5; k++) egg.tap((now += 200));
  };
  /** A PUT the test answers by hand. */
  const held = () => {
    const pending: (() => void)[] = [];
    put = () => new Promise<unknown>((resolve) => pending.push(() => resolve({})));
    return { answer: async () => (pending.shift()?.(), await flush()), get open() { return pending.length; } };
  };

  beforeEach(() => {
    now = 0;
    saved = [];
    puts = [];
    loads = true;
    put = async () => ({ starHead: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts from the browser value, loading the sticker only when it is on', async () => {
    const off = hooks();
    new StarEgg(new Session(), off.h, false);
    expect(off.topper.set).toHaveBeenCalledWith(false);
    expect(off.topper.load).not.toHaveBeenCalled();
    const on = hooks();
    const egg = new StarEgg(new Session(), on.h, true);
    expect(egg.isOn).toBe(true);
    expect(on.topper.set).toHaveBeenCalledWith(true);
    expect(on.topper.load).toHaveBeenCalled();
    await flush();
    expect(egg.isOn).toBe(true);
  });

  it('a stored head whose sticker fails to load shows the star, quietly, keeping the preference for next time', async () => {
    loads = false;
    const { h, topper, toast, sfx } = hooks();
    const egg = new StarEgg(new Session(), h, true);
    await flush();
    expect(egg.isOn).toBe(false);
    expect(topper.set).toHaveBeenLastCalledWith(false);
    expect(topper.flip).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
    expect(sfx.jingle).not.toHaveBeenCalled();
  });

  it('taps 1–4 wobble and tick (rising), starting the sticker loading; the fifth flips with the jingle and the toast', async () => {
    const { h, topper, sfx, toast } = hooks();
    const egg = new StarEgg(new Session(), h, false);
    for (let k = 0; k < 4; k++) egg.tap((now += 200));
    expect(topper.tap.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4]);
    expect(sfx.starTap.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3]);
    expect(topper.load).toHaveBeenCalled();
    expect(topper.flip).not.toHaveBeenCalled();
    egg.tap((now += 200));
    await flush();
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    expect(toast).toHaveBeenCalledWith('Ho ho ho.');
    expect(topper.flip).toHaveBeenCalledWith(true, now);
    expect(sfx.jingle).toHaveBeenCalledWith(true);
    // Five more bring it back, at once.
    fiveTaps(egg);
    expect(egg.isOn).toBe(false);
    expect(saved).toEqual([true, false]);
    expect(toast).toHaveBeenLastCalledWith('Back to the star.');
    expect(topper.flip).toHaveBeenLastCalledWith(false, now);
    expect(sfx.jingle).toHaveBeenLastCalledWith(false);
  });

  it('if the sticker fails to load, the fifth tap does nothing at all: no toggle, flip, jingle, toast or PUT', async () => {
    loads = false;
    const { h, topper, sfx, toast } = hooks();
    const session = new Session();
    session.set(user(false));
    const egg = new StarEgg(session, h, false);
    fiveTaps(egg);
    await flush();
    expect(egg.isOn).toBe(false);
    expect(saved).toEqual([]);
    expect(puts).toEqual([]);
    expect(topper.flip).not.toHaveBeenCalled();
    expect(sfx.jingle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    // Once it can load, five more taps work.
    loads = true;
    fiveTaps(egg);
    await flush();
    expect(egg.isOn).toBe(true);
  });

  it('typing hohoho toggles too', async () => {
    const { h, topper } = hooks();
    const egg = new StarEgg(new Session(), h, false);
    const results = [...'hohoho'].map((c) => egg.key({ key: c, target: document.body, ctrlKey: false, metaKey: false, altKey: false, repeat: false }, (now += 100)));
    expect(results.at(-1)).toBe(true);
    await flush();
    expect(egg.isOn).toBe(true);
    expect(topper.flip).toHaveBeenCalledWith(true, now);
  });

  it('signed out: nothing is sent', async () => {
    const { h } = hooks();
    const egg = new StarEgg(new Session(), h, false);
    fiveTaps(egg);
    await flush();
    expect(egg.isOn).toBe(true);
    expect(puts).toEqual([]);
  });

  it('signed in: the view and the browser change at once, the account in the background; a failed PUT keeps the local state quietly', async () => {
    const { h, toast } = hooks();
    const session = new Session();
    session.set(user(false));
    const egg = new StarEgg(session, h, false);
    put = async () => {
      throw new Error('offline');
    };
    fiveTaps(egg);
    await flush();
    expect(puts).toEqual([true]);
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    expect(toast).toHaveBeenCalledTimes(1); // "Ho ho ho." only: nothing about the failure
    // The session's copy follows the toggle, so the same user object set again doesn't undo it.
    session.set(session.current as User);
    expect(egg.isOn).toBe(true);
  });

  it('PUTs go one at a time, latest-wins: quick toggles never leave the account on an older value', async () => {
    const { h } = hooks();
    const session = new Session();
    session.set(user(false));
    const egg = new StarEgg(session, h, false);
    const net = held();
    fiveTaps(egg); // on
    await flush();
    expect(puts).toEqual([true]);
    fiveTaps(egg); // off
    fiveTaps(egg); // on
    await flush();
    fiveTaps(egg); // off: the last word
    expect(egg.isOn).toBe(false);
    expect(net.open).toBe(1); // never two at once
    expect(puts).toEqual([true]);
    await net.answer();
    // The in-between values were coalesced: only the latest goes next.
    expect(puts).toEqual([true, false]);
    await net.answer();
    expect(net.open).toBe(0);
    expect(puts.at(-1)).toBe(egg.isOn);
  });

  it('an account answer that arrives while a PUT is out never overwrites the view', async () => {
    const { h, topper } = hooks();
    const session = new Session();
    session.set(user(false));
    const egg = new StarEgg(session, h, false);
    const net = held();
    fiveTaps(egg);
    await flush();
    expect(egg.isOn).toBe(true);
    const flips = topper.flip.mock.calls.length;
    // /api/me (or the name answer), issued before the PUT landed: still says the star.
    const stale = user(false);
    session.set(stale);
    await flush();
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    expect(topper.flip.mock.calls.length).toBe(flips);
    expect(stale.starHead).toBe(true); // brought in line, so setting it again later is harmless
    await net.answer();
    session.set(stale);
    expect(egg.isOn).toBe(true);
  });

  it("on load or sign-in the account's value wins and is written to the browser, flipping quietly", async () => {
    const { h, topper, sfx, toast } = hooks();
    const session = new Session();
    const egg = new StarEgg(session, h, false);
    session.set(user(true));
    await flush();
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    expect(topper.flip).toHaveBeenCalledWith(true, now);
    expect(sfx.jingle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(puts).toEqual([]); // the account's own value is never sent back
    // The same value again changes nothing.
    session.set(user(true));
    await flush();
    expect(saved).toEqual([true]);
    // And back to the star when the account says so (another device turned it off).
    session.set(user(false));
    expect(egg.isOn).toBe(false);
    expect(saved).toEqual([true, false]);
  });

  it("the account's head, when the sticker can't load: the star stays, quietly", async () => {
    loads = false;
    const { h, topper, toast } = hooks();
    const session = new Session();
    const egg = new StarEgg(session, h, false);
    session.set(user(true));
    await flush();
    expect(egg.isOn).toBe(false);
    expect(topper.flip).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('signing out keeps the browser value', async () => {
    const { h } = hooks();
    const session = new Session();
    const egg = new StarEgg(session, h, false);
    session.set(user(true));
    await flush();
    session.set(null);
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
  });

  describe('secret mode hooks', () => {
    const key = (k: string) => ({ key: k, target: document.body, ctrlKey: false, metaKey: false, altKey: false, repeat: false });

    it("reports the starting value, then the player's toggles as loud", async () => {
      const { h } = hooks();
      const mode = vi.fn();
      h.mode = mode;
      const egg = new StarEgg(new Session(), h, false);
      expect(mode).toHaveBeenCalledWith(false, 'start');
      fiveTaps(egg);
      await flush();
      expect(mode).toHaveBeenLastCalledWith(true, 'loud');
      fiveTaps(egg);
      expect(mode).toHaveBeenLastCalledWith(false, 'loud');
    });

    it('calls gesture synchronously inside the fifth tap and the last letter, with where it is heading', () => {
      const { h } = hooks();
      const gesture = vi.fn();
      h.gesture = gesture;
      const egg = new StarEgg(new Session(), h, false);
      for (let k = 0; k < 4; k++) egg.tap((now += 200));
      expect(egg.tapCount).toBe(4);
      expect(gesture).not.toHaveBeenCalled();
      egg.tap((now += 200));
      expect(gesture).toHaveBeenCalledWith(true); // before the sticker's load has resolved
      const typedHooks = hooks().h;
      const g2 = vi.fn();
      typedHooks.gesture = g2;
      const typed = new StarEgg(new Session(), typedHooks, true);
      for (const c of 'hohoho') typed.key(key(c), (now += 100));
      expect(g2).toHaveBeenCalledWith(false);
    });

    it('a sign-in that changes it is quiet', async () => {
      const { h } = hooks();
      const mode = vi.fn();
      h.mode = mode;
      const session = new Session();
      new StarEgg(session, h, false);
      session.set(user(true));
      await flush();
      expect(mode).toHaveBeenLastCalledWith(true, 'quiet');
    });

    it("a sign-in that lands while the player's own switch-on waits for the sticker leaves it loud", async () => {
      const { h, topper } = hooks();
      let done!: (ok: boolean) => void;
      const sticker = new Promise<boolean>((r) => (done = r));
      topper.load.mockImplementation(() => sticker);
      const mode = vi.fn();
      h.mode = mode;
      const session = new Session();
      const egg = new StarEgg(session, h, false);
      session.set(user(true)); // the account's head, waiting for the sticker
      fiveTaps(egg); // and the player's own toggle, waiting for it too
      done(true);
      await flush();
      expect(egg.isOn).toBe(true);
      expect(mode.mock.calls.filter(([on]) => on)).toEqual([[true, 'loud']]);
      expect(puts).toEqual([true]);
    });

    it('a stored head whose sticker fails turns secret mode off quietly', async () => {
      loads = false;
      const { h } = hooks();
      const mode = vi.fn();
      h.mode = mode;
      new StarEgg(new Session(), h, true);
      expect(mode).toHaveBeenCalledWith(true, 'start');
      await flush();
      expect(mode).toHaveBeenLastCalledWith(false, 'quiet');
    });
  });
});
