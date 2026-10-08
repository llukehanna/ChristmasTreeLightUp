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
  const hooks = () => {
    const topper = { isHead: false, load: vi.fn(async () => true), set: vi.fn(), flip: vi.fn(), tap: vi.fn() };
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

  beforeEach(() => {
    now = 0;
    saved = [];
    puts = [];
    put = async () => ({ starHead: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts from the browser value, loading the sticker only when it is on', () => {
    const off = hooks();
    new StarEgg(new Session(), off.h, false);
    expect(off.topper.set).toHaveBeenCalledWith(false);
    expect(off.topper.load).not.toHaveBeenCalled();
    const on = hooks();
    expect(new StarEgg(new Session(), on.h, true).isOn).toBe(true);
    expect(on.topper.set).toHaveBeenCalledWith(true);
    expect(on.topper.load).toHaveBeenCalled();
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
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    expect(toast).toHaveBeenCalledWith('Ho ho ho.');
    await flush();
    expect(topper.flip).toHaveBeenCalledWith(true, now);
    expect(sfx.jingle).toHaveBeenCalledWith(true);
    // Five more bring it back.
    fiveTaps(egg);
    expect(egg.isOn).toBe(false);
    expect(saved).toEqual([true, false]);
    expect(toast).toHaveBeenLastCalledWith('Back to the star.');
    await flush();
    expect(topper.flip).toHaveBeenLastCalledWith(false, now);
    expect(sfx.jingle).toHaveBeenLastCalledWith(false);
  });

  it('typing hohoho toggles too', async () => {
    const { h, topper } = hooks();
    const egg = new StarEgg(new Session(), h, false);
    const results = [...'hohoho'].map((c) => egg.key({ key: c, target: document.body, ctrlKey: false, metaKey: false, altKey: false, repeat: false }, (now += 100)));
    expect(results.at(-1)).toBe(true);
    expect(egg.isOn).toBe(true);
    await flush();
    expect(topper.flip).toHaveBeenCalledWith(true, now);
  });

  it('signed out: nothing is sent', () => {
    const { h } = hooks();
    const egg = new StarEgg(new Session(), h, false);
    fiveTaps(egg);
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
    expect(puts).toEqual([true]);
    expect(egg.isOn).toBe(true);
    await flush();
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    expect(toast).toHaveBeenCalledTimes(1); // "Ho ho ho." only: nothing about the failure
    // The session's copy follows the toggle, so the same user object set again doesn't undo it.
    session.set(session.current as User);
    expect(egg.isOn).toBe(true);
  });

  it("on load or sign-in the account's value wins and is written to the browser, flipping quietly", async () => {
    const { h, topper, sfx, toast } = hooks();
    const session = new Session();
    const egg = new StarEgg(session, h, false);
    session.set(user(true));
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
    await flush();
    expect(topper.flip).toHaveBeenCalledWith(true, now);
    expect(sfx.jingle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    // The same value again changes nothing.
    session.set(user(true));
    expect(saved).toEqual([true]);
  });

  it('signing out keeps the browser value', () => {
    const { h } = hooks();
    const session = new Session();
    const egg = new StarEgg(session, h, false);
    session.set(user(true));
    session.set(null);
    expect(egg.isOn).toBe(true);
    expect(saved).toEqual([true]);
  });
});
